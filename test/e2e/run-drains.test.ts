import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { startConsole } from "@nola-lang/console";
import { beforeAll, describe, expect, it } from "vitest";
import { type CapturedError, capture, ensureBuilt } from "./helpers/ensure-built.js";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const CLI = join(ROOT, "packages", "nola-lang", "dist", "main.js");

type TraceRow = { kind: string; status: string };

/**
 * `nola run` is documented as a shortcut for `node --import nola-lang/register
 * <entry>`, and that covers WHEN the process ends: like node, it exits once the
 * event loop drains, not once the entry module has evaluated. What sits in that
 * gap is the tracer's last envelopes — one fire-and-forget POST each — so a
 * process.exit right after the module's last statement cut them off, and the
 * console showed a run's final ask and its <module> frame as running forever
 * (the agent-loop example, 2026-09-30).
 */
describe("nola run exits when the event loop drains, like node", () => {
  beforeAll(() => ensureBuilt(ROOT), 600_000);

  it("delivers every trace envelope to the console before exiting — the last ask and its frame settle", { timeout: 120_000 }, async () => {
    const running = await startConsole({ port: 0, path: await mkdtemp(join(tmpdir(), "nola-run-console-")) });
    const kinds: string[] = [];
    running.onEvent((notice) => kinds.push(notice.kind));
    try {
      await capture(process.execPath, [CLI, "run", "src/main.tsi"], {
        cwd: join(ROOT, "examples", "agent-loop"),
        env: { ...process.env, NOLA_TRACING_URL: running.url },
      });
      // Four passes through the loop, each a <module> frame holding one ask: six envelopes per pass.
      expect(kinds.filter((kind) => kind === "askEnd")).toHaveLength(4);
      expect(kinds.filter((kind) => kind === "invocationEnd")).toHaveLength(4);
      const { records } = (await (await fetch(`${running.url}/api/records`)).json()) as { records: TraceRow[] };
      expect(records.filter((row) => row.kind === "invocation")).toHaveLength(4);
      expect(records.map((row) => row.status)).toEqual(Array<string>(8).fill("ok"));
    } finally {
      await running.close();
    }
  });

  it("a timer the program leaves behind fires first, and its process.exitCode is the exit code", { timeout: 120_000 }, async () => {
    const dir = await mkdtemp(join(tmpdir(), "nola-run-drain-"));
    await writeFile(join(dir, "main.ts"), 'console.log("early");\nsetTimeout(() => {\n  console.log("late");\n  process.exitCode = 3;\n}, 200);\n');
    const failure = await capture(process.execPath, [CLI, "run", "main.ts"], { cwd: dir }).then(
      () => undefined,
      (error: CapturedError) => error,
    );
    expect(failure?.code).toBe(3);
    expect(failure?.stdout).toBe("early\nlate\n");
  });

  // Node itself exits the moment a top-level rejection goes uncaught — pending work never runs
  // (`node file.mjs` with `await Promise.reject(…)` after a setTimeout: the timer never fires).
  // A failed ask's askEnd and its frame's invocationEnd are exactly such pending work, and a
  // console that shows a crashed ask as running forever hides the one outcome it exists to show,
  // so `nola run` gives a crashed program's event loop a bounded chance to drain before exiting 1.
  it("a program that crashes still lands its trace: the failed ask and its frame settle as errors, and nola run exits 1", { timeout: 120_000 }, async () => {
    const app = await mkdtemp(join(tmpdir(), "nola-run-crash-"));
    await mkdir(join(app, "src"), { recursive: true });
    await writeFile(join(app, "package.json"), JSON.stringify({ name: "run-crash-app", type: "module" }));
    await writeFile(join(app, "nola.config.ts"), 'export default { model: { name: "down", infer: async () => { throw new Error("the model is down"); } } };\n');
    await writeFile(join(app, "src", "main.tsi"), "const answer = ask `anything`: string;\nconsole.log(answer);\n");
    const scope = join(app, "node_modules", "@nola-lang");
    await mkdir(scope, { recursive: true });
    await symlink(join(ROOT, "packages", "runtime"), join(scope, "runtime"), "junction");

    const running = await startConsole({ port: 0, path: await mkdtemp(join(tmpdir(), "nola-run-console-")) });
    try {
      const failure = await capture(process.execPath, [CLI, "run", "src/main.tsi"], {
        cwd: app,
        env: { ...process.env, NOLA_TRACING_URL: running.url },
      }).then(
        () => undefined,
        (error: CapturedError) => error,
      );
      expect(failure?.code).toBe(1);
      expect(failure?.stderr).toContain("the model is down");
      const { records } = (await (await fetch(`${running.url}/api/records`)).json()) as { records: TraceRow[] };
      expect(records.map((row) => [row.kind, row.status])).toEqual([
        ["invocation", "error"],
        ["extract", "error"],
      ]);
    } finally {
      await running.close();
    }
  });
});
