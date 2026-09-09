import { existsSync, mkdtempSync } from "node:fs";
import { createServer } from "node:net";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { defaultConsolePath, findFreePort, startConsole } from "@nola-lang/console";
import type { NolaIngestEnvelope } from "@nola-lang/core";
import { describe, expect, it } from "vitest";

describe("findFreePort", () => {
  it("skips an occupied port", async () => {
    const base = await findFreePort("127.0.0.1", 45141);
    const blocker = createServer();
    await new Promise<void>((r) => blocker.listen({ port: base, host: "127.0.0.1" }, r));
    try {
      expect(await findFreePort("127.0.0.1", base)).toBe(base + 1);
    } finally {
      await new Promise<void>((r) => blocker.close(() => r()));
    }
  });
});

describe("console path", () => {
  it("defaults to the per-machine home location — one console instance, one root folder", () => {
    expect(defaultConsolePath()).toBe(join(homedir(), ".nola", "console"));
  });

  it("`path` is the console root; the database lives under data/ inside it", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nola-console-"));
    const running = await startConsole({ port: 0, path: join(dir, "root") });
    try {
      expect(running.path).toBe(join(dir, "root"));
      expect(running.dbPath).toBe(join(dir, "root", "data", "console.db"));
      expect(existsSync(running.dbPath)).toBe(true);
    } finally {
      await running.close();
    }
  });
});

describe("startConsole", () => {
  it("serves the app end to end and closes cleanly", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nola-console-"));
    const running = await startConsole({
      path: dir,
      port: await findFreePort("127.0.0.1", 45241),
    });
    try {
      expect(running.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
      expect(running.dbPath).toBe(join(dir, "data", "console.db"));
      const caps = await fetch(`${running.url}/v1/capabilities`);
      expect(((await caps.json()) as { ingest: boolean }).ingest).toBe(true);
      // Every ingested envelope reaches a subscribed listener — the CLI prints one line per event from it.
      const seen: NolaIngestEnvelope[] = [];
      const unsubscribe = running.onEvent((e) => seen.push(e));
      const envelope: NolaIngestEnvelope = {
        v: 1,
        runId: "r",
        pid: 1,
        seq: 0,
        at: 1,
        kind: "askStart",
        event: { askId: "a1", site: { file: "f.tsi", loc: "1:1" }, provider: "mock" },
      };
      const posted = await fetch(`${running.url}/v1/ingest`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(envelope),
      });
      expect(posted.status).toBe(204);
      expect(seen).toEqual([envelope]);
      unsubscribe();
      // A spanPath-less askStart (foreign/old sender) lands under the synthetic per-run trace.
      const records = (await (await fetch(`${running.url}/api/records`)).json()) as {
        records: Array<{ kind: string; id: string; askCount?: number }>;
      };
      expect(records.records[0]).toMatchObject({ kind: "invocation", id: "run:r", askCount: 1 });
    } finally {
      await running.close();
    }
  });

  it("port 0 binds an OS-assigned port and reports the real one", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nola-console-"));
    const running = await startConsole({ path: dir, port: 0 });
    try {
      expect(running.port).toBeGreaterThan(0);
      expect(running.url).toBe(`http://127.0.0.1:${running.port}`);
    } finally {
      await running.close();
    }
  });
});
