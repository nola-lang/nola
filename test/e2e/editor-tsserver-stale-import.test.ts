// Delete a .tsi that a plain .ts imports, then re-create it: the TS2307 must
// clear WITHOUT reopening the file. Volar resolves `./x.tsi` by intercepting
// probes for the phantom `x.d.tsi.ts`, bypassing tsserver's resolution cache
// entirely — so tsserver installs no failed-lookup watcher on the real .tsi
// path and never re-resolves when the file comes back. The plugin's
// resolution-watch decoration closes that gap.
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ensureBuilt } from "./helpers/ensure-built.js";
import { type TsDiagnostic, TsServerHandle } from "./helpers/tsserver.js";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const TSSERVER = join(ROOT, "node_modules", "typescript", "lib", "tsserver.js");

let fixture: string;
let main: string;
let tsi: string;
let tsiContent: string;
let server: TsServerHandle;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function pollDiags(predicate: (codes: number[]) => boolean, deadlineMs: number): Promise<number[]> {
  const t0 = Date.now();
  for (;;) {
    const diags = await server.request<TsDiagnostic[]>("semanticDiagnosticsSync", { file: main });
    const codes = diags.map((d) => d.code ?? 0);
    if (predicate(codes)) return codes;
    if (Date.now() - t0 > deadlineMs) return codes;
    await sleep(500);
  }
}

beforeAll(async () => {
  await ensureBuilt(ROOT);
  fixture = mkdtempSync(join(tmpdir(), "nola-stale-import-"));
  cpSync(join(ROOT, "test", "e2e", "fixtures", "ts6-companions"), fixture, { recursive: true });
  main = join(fixture, "src", "index.ts");
  tsi = join(fixture, "src", "extract.tsi");
  tsiContent = readFileSync(tsi, "utf8");
  server = new TsServerHandle(TSSERVER, ROOT);
  server.send("configure", { hostInfo: "vitest" });
  server.send("open", { file: main, projectRootPath: fixture });
}, 400_000);

afterAll(() => {
  server?.kill();
  rmSync(fixture, { recursive: true, force: true });
});

describe("re-adding a deleted .tsi clears the import error", () => {
  it("TS2307 appears on delete and clears on re-create, no reopen", { timeout: 120_000 }, async () => {
    expect(await pollDiags((c) => c.length === 0, 30_000)).toEqual([]);

    rmSync(tsi);
    expect(await pollDiags((c) => c.includes(2307), 30_000)).toContain(2307);

    writeFileSync(tsi, tsiContent);
    expect(await pollDiags((c) => c.length === 0, 30_000)).toEqual([]);
  });

  it("content edits after the revival keep propagating (empty file -> 2305 -> restored -> clean)", { timeout: 120_000 }, async () => {
    // The user's exact cycle: delete, re-create EMPTY (TS2305 — correct),
    // then paste the real content back. The revived ScriptInfo reloads
    // content but no longer dirties the project on change, so without the
    // persistent watch the 2305 stayed until an unrelated edit nudged a
    // program rebuild.
    rmSync(tsi);
    expect(await pollDiags((c) => c.includes(2307), 30_000)).toContain(2307);

    writeFileSync(tsi, "");
    expect(await pollDiags((c) => c.length > 0 && !c.includes(2307), 30_000)).toContain(2305);

    writeFileSync(tsi, tsiContent);
    expect(await pollDiags((c) => c.length === 0, 30_000)).toEqual([]);
  });
});
