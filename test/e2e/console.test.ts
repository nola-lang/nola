import { type ChildProcess, spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ensureBuilt } from "./helpers/ensure-built.js";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const CLI = join(ROOT, "packages", "nola-lang", "dist", "main.js");
/** SGR colour sequences — the banner is coloured whenever the environment forces colour (some shells and CI do). */
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");

let child: ChildProcess | undefined;

afterAll(() => {
  child?.kill();
});

describe("nola console e2e", () => {
  beforeAll(async () => {
    await ensureBuilt(ROOT);
  }, 300_000);

  it("starts, accepts ingestion, serves the records stream", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nola-console-e2e-"));
    child = spawn(process.execPath, [CLI, "console", "--port", "0"], {
      cwd: dir,
      // The console root defaults to ~/.nola/console — point the child's home at the temp dir to keep the e2e hermetic
      // (os.homedir() reads USERPROFILE on Windows and HOME elsewhere).
      env: { ...process.env, HOME: dir, USERPROFILE: dir },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const proc = child;
    const url = await new Promise<string>((resolve, reject) => {
      let out = "";
      const timer = setTimeout(() => reject(new Error(`console never printed its URL; output so far:\n${out}`)), 60_000);
      proc.stdout?.on("data", (chunk: Buffer) => {
        out += chunk.toString();
        // Strip colour escapes so the match sees plain text either way.
        const m = out.replace(ANSI, "").match(/Local:\s+(http:\/\/[^\s]+)/);
        if (m?.[1]) {
          clearTimeout(timer);
          resolve(m[1]);
        }
      });
      proc.on("exit", (code) => reject(new Error(`console exited early (${code}):\n${out}`)));
    });

    const caps = (await (await fetch(`${url}/v1/capabilities`)).json()) as {
      protocol: number;
      infer: boolean;
      ingest: boolean;
    };
    expect(caps).toEqual({ protocol: 1, infer: false, ingest: true });

    const post = async (kind: string, event: unknown, seq: number): Promise<void> => {
      const res = await fetch(`${url}/v1/ingest`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ v: 1, runId: "e2e-run", pid: 7, project: "e2e-app", seq, at: Date.now(), kind, event }),
      });
      expect(res.status).toBe(204);
    };

    // One full trace: root e2eFn → attached notify holding one extract (two attempts) and one call.
    let seq = 0;
    const send = (kind: string, event: unknown): Promise<void> => post(kind, event, seq++);
    await send("invocationStart", { invocationId: "e2e-inv", spanPath: ["e2e-inv"], fn: "e2eFn", file: "main.tsi", detached: false });
    await send("invocationStart", {
      invocationId: "e2e-child",
      parentInvocationId: "e2e-inv",
      spanPath: ["e2e-inv", "e2e-child"],
      fn: "notify",
      file: "main.tsi",
      detached: false,
    });
    await send("askStart", {
      askId: "e2e-ask",
      site: { file: "main.tsi", loc: "1:1" },
      provider: "mock",
      invocationId: "e2e-child",
      spanPath: ["e2e-inv", "e2e-child"],
      def: "e2".repeat(32),
      instruction: "triage the customer message",
      kind: "extract",
      typeText: "Ticket",
    });
    await send("providerRequest", { askId: "e2e-ask", attempt: 1, provider: "mock" });
    await send("providerResponse", { askId: "e2e-ask", attempt: 1, provider: "mock", text: "no", durationMs: 40 });
    await send("validationFailed", { askId: "e2e-ask", attempt: 1, error: "expected string" });
    await send("providerRequest", { askId: "e2e-ask", attempt: 2, provider: "mock" });
    await send("providerResponse", { askId: "e2e-ask", attempt: 2, provider: "mock", text: "ok", durationMs: 50 });
    await send("askEnd", {
      askId: "e2e-ask",
      receipt: {
        askId: "e2e-ask",
        site: { file: "main.tsi", loc: "1:1" },
        servedBy: "mock",
        attempts: 2,
        durationMs: 100,
        outcome: { ok: true, value: "ok" },
        invocationId: "e2e-child",
        spanPath: ["e2e-inv", "e2e-child"],
        def: "e2".repeat(32),
        kind: "extract",
      },
    });
    await send("askStart", {
      askId: "e2e-call",
      site: { file: "main.tsi", loc: "2:1" },
      provider: "mock",
      invocationId: "e2e-child",
      spanPath: ["e2e-inv", "e2e-child"],
      def: "c2".repeat(32),
      instruction: 'Generate the arguments for calling the function "send". politely',
      kind: "call",
      callee: "send",
      hint: "politely",
    });
    await send("askEnd", {
      askId: "e2e-call",
      receipt: {
        askId: "e2e-call",
        site: { file: "main.tsi", loc: "2:1" },
        servedBy: "mock",
        attempts: 1,
        durationMs: 20,
        outcome: { ok: true, value: { arg0: "hi" } },
        invocationId: "e2e-child",
        spanPath: ["e2e-inv", "e2e-child"],
        def: "c2".repeat(32),
        kind: "call",
      },
    });
    await send("invocationEnd", {
      invocationId: "e2e-child",
      parentInvocationId: "e2e-inv",
      status: "ok",
      durationMs: 130,
      trace: { kind: "invocation", invocationId: "e2e-child", fn: "notify", file: "main.tsi", spans: [] },
    });
    await send("invocationEnd", {
      invocationId: "e2e-inv",
      status: "ok",
      durationMs: 150,
      trace: { kind: "invocation", invocationId: "e2e-inv", fn: "e2eFn", file: "main.tsi", spans: [] },
    });

    const projects = (await (await fetch(`${url}/api/projects`)).json()) as {
      projects: Array<{ name: string | null; traceCount: number }>;
    };
    expect(projects.projects[0]).toMatchObject({ name: "e2e-app", traceCount: 1 });

    const records = (await (await fetch(`${url}/api/records?project=e2e-app`)).json()) as {
      records: Array<Record<string, unknown>>;
    };
    expect(records.records.map((r) => [r.kind, r.id, r.depth, r.label])).toEqual([
      ["invocation", "e2e-inv", 0, "e2eFn(..)"],
      ["invocation", "e2e-child", 1, "notify(..)"],
      ["extract", "e2e-ask", 2, "..`triage the customer message`<Ticket>"],
      ["call", "e2e-call", 2, "send`politely`(..)"],
    ]);
    expect(records.records[0]).toMatchObject({ status: "ok", runId: "e2e-run", askCount: 2, errorCount: 0 });

    const detail = (await (await fetch(`${url}/api/traces/e2e-child`)).json()) as {
      node: { id: string };
      records: unknown[];
    };
    expect(detail.node.id).toBe("e2e-child");
    expect(detail.records).toHaveLength(3);

    // 7 of the envelopes name the extract ask.
    const ask = (await (await fetch(`${url}/api/asks/e2e-ask`)).json()) as {
      events: unknown[];
      attemptRows: Array<{ validation?: string }>;
      invocationChain: unknown[];
    };
    expect(ask.events).toHaveLength(7);
    expect(ask.attemptRows[0]?.validation).toBe("failed");
    expect(ask.invocationChain).toHaveLength(2);

    const defs = (await (await fetch(`${url}/api/definitions?project=e2e-app`)).json()) as {
      definitions: Array<{ def: string; executions: number; okCount: number; instruction?: string; kind?: string }>;
    };
    expect(defs.definitions.find((d) => d.def === "e2".repeat(32))).toMatchObject({
      executions: 1,
      okCount: 1,
      instruction: "triage the customer message",
      kind: "extract",
    });
    const defDetail = (await (await fetch(`${url}/api/definitions/${"e2".repeat(32)}`)).json()) as {
      asks: Array<{ askId: string }>;
    };
    expect(defDetail.asks[0]?.askId).toBe("e2e-ask");

    const page = await (await fetch(`${url}/`)).text();
    expect(page).toContain('<div id="root">');
    const assetPath = page.match(/src="(\/assets\/[^"]+\.js)"/)?.[1];
    expect(assetPath).toBeTruthy();
    const asset = await fetch(`${url}${assetPath}`);
    expect(asset.status).toBe(200);
    expect(asset.headers.get("content-type")).toContain("javascript");
  }, 120_000);
});
