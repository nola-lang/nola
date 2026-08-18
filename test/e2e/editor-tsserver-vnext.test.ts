// The crash VS Code's own TypeScript (6.x) exposed: when a .tsi enters the
// program through a plain-.ts import (NOT as a tsconfig root — include is
// "src/**/*.ts" here), its companion module becomes a program source file,
// and TS 6's project telemetry asserts every program file has a ScriptInfo
// (Project.getScriptInfos). Companions are synthetic, so without the
// ServerHost decoration the FIRST project load died with "Debug Failure.
// False expression: getScriptInfo" and the whole project stayed broken.
// typescript-vnext is a pinned npm alias of the TS version VS Code ships.
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ensureBuilt } from "./helpers/ensure-built.js";
import { type TsDiagnostic, TsServerHandle } from "./helpers/tsserver.js";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const FIXTURE = join(ROOT, "test", "e2e", "fixtures", "ts6-companions");
const INDEX = join(FIXTURE, "src", "index.ts");
const TSSERVER = join(ROOT, "node_modules", "typescript-vnext", "lib", "tsserver.js");

let server: TsServerHandle;

beforeAll(async () => {
  await ensureBuilt(ROOT);
  server = new TsServerHandle(TSSERVER, ROOT);
  server.send("configure", { hostInfo: "vitest" });
}, 400_000);

afterAll(() => {
  server?.kill();
});

describe("tsserver vnext over a non-root .tsi with a cross-file companion", () => {
  it("project load survives telemetry and index.ts type-checks clean", { timeout: 120_000 }, async () => {
    // VS Code opens files via updateOpen — the crash fired inside this very
    // request (project load → updateGraph → sendProjectTelemetry).
    await server.request("updateOpen", { openFiles: [{ file: INDEX, projectRootPath: FIXTURE }] });
    const diags = await server.request<TsDiagnostic[]>("semanticDiagnosticsSync", { file: INDEX });
    expect(diags).toEqual([]);
  });

  it("edits still refresh diagnostics under vnext", { timeout: 120_000 }, async () => {
    // line 1: comment out the .tsi import; index.ts must show TS2304, then clear.
    server.send("change", { file: INDEX, line: 1, offset: 1, endLine: 1, endOffset: 1, insertString: "// " });
    const withoutImport = await server.request<TsDiagnostic[]>("semanticDiagnosticsSync", { file: INDEX });
    expect(withoutImport.some((d) => d.code === 2304)).toBe(true);
    server.send("change", { file: INDEX, line: 1, offset: 1, endLine: 1, endOffset: 4, insertString: "" });
    expect(await server.request<TsDiagnostic[]>("semanticDiagnosticsSync", { file: INDEX })).toEqual([]);
  });
});
