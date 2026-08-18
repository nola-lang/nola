// The tsserver side of the editor story (the LSP e2e covers .tsi documents;
// THIS covers plain .ts documents importing .tsi — VS Code routes main.ts
// through the built-in tsserver + our plugin, not the Nola LSP). Drives the
// real tsserver.js over its stdio protocol with the plugin loaded the same
// way VS Code loads it (globalPlugins + pluginProbeLocations).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ensureBuilt } from "./helpers/ensure-built.js";
import { type TsDiagnostic, TsServerHandle } from "./helpers/tsserver.js";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const FIXTURE = join(ROOT, "examples", "cross-file-types");
const MAIN = join(FIXTURE, "src", "main.ts");
const TSSERVER = join(ROOT, "node_modules", "typescript", "lib", "tsserver.js");

let server: TsServerHandle;

beforeAll(async () => {
  await ensureBuilt(ROOT);
  server = new TsServerHandle(TSSERVER, ROOT);
  server.send("configure", { hostInfo: "vitest" });
  server.send("open", { file: MAIN, projectRootPath: FIXTURE });
}, 400_000);

afterAll(() => {
  server?.kill();
});

describe("tsserver plugin over examples/cross-file-types (plain .ts importing .tsi)", () => {
  it("main.ts resolves ./report.tsi virtually — no TS2307, no on-disk declarations", { timeout: 120_000 }, async () => {
    const diags = await server.request<TsDiagnostic[]>("semanticDiagnosticsSync", { file: MAIN });
    expect(diags.filter((d) => d.code === 2307)).toEqual([]);
    expect(diags).toEqual([]);
  });

  it("F12 on the imported infer function lands in report.tsi", { timeout: 120_000 }, async () => {
    // Target the CALL SITE, not the first textual occurrence — MAIN is a
    // dogfood playground and its first occurrence is sometimes a comment.
    const text = readFileSync(MAIN, "utf8");
    const index = text.indexOf("await extractPerson") + "await ".length;
    const line = text.slice(0, index).split("\n").length;
    const offset = index - (text.lastIndexOf("\n", index - 1) + 1) + 1;
    const body = await server.request<{ definitions: Array<{ file: string }> }>("definitionAndBoundSpan", {
      file: MAIN,
      line,
      offset,
    });
    expect(body.definitions.length).toBeGreaterThan(0);
    expect(body.definitions[0]?.file.endsWith("report.tsi")).toBe(true);
  });

  // The edit-flow tests run LAST and use controlled in-memory content (MAIN is
  // a dogfood playground — disk line numbers are not stable). They reopen MAIN
  // with fileContent; nothing after them depends on the disk snapshot.
  const EDIT_CONTENT = [
    'import { extractPerson } from "./report.tsi";',
    'const result = await extractPerson("Ada");',
    "console.log(JSON.stringify(result));",
    "",
  ].join("\n");

  it("edits refresh diagnostics — removing the import must not crash the rebuild", { timeout: 120_000 }, async () => {
    // Toggling the import pulls report.tsi's synthetic companion
    // (models.nola.ts — no ScriptInfo) out of and back into the program.
    // Before the fix the rebuild threw "Debug Failure" in
    // ProjectService.setDocument, freezing diagnostics until close/reopen.
    server.send("close", { file: MAIN });
    server.send("open", { file: MAIN, projectRootPath: FIXTURE, fileContent: EDIT_CONTENT });
    expect(await server.request<TsDiagnostic[]>("semanticDiagnosticsSync", { file: MAIN })).toEqual([]);

    server.send("change", { file: MAIN, line: 1, offset: 1, endLine: 1, endOffset: 1, insertString: "// " });
    const withoutImport = await server.request<TsDiagnostic[]>("semanticDiagnosticsSync", { file: MAIN });
    expect(withoutImport.some((d) => d.code === 2304)).toBe(true);

    // Restore it: the error must clear without reopening.
    server.send("change", { file: MAIN, line: 1, offset: 1, endLine: 1, endOffset: 4, insertString: "" });
    expect(await server.request<TsDiagnostic[]>("semanticDiagnosticsSync", { file: MAIN })).toEqual([]);
  });

  it("unimported infer function gets the auto-import completion and code fix from ./report.tsi", { timeout: 120_000 }, async () => {
    server.send("change", { file: MAIN, line: 1, offset: 1, endLine: 1, endOffset: 1, insertString: "// " });

    // completion mid-identifier on line 2: `const result = await extr|actPerson("Ada");`
    const completions = await server.request<{ entries: Array<{ name: string; source?: string }> }>("completionInfo", {
      file: MAIN,
      line: 2,
      offset: 27,
      includeExternalModuleExports: true,
      includeInsertTextCompletions: true,
    });
    const autoImport = completions.entries.find((e) => e.name === "extractPerson" && e.source === "./report.tsi");
    expect(autoImport).toBeDefined();

    // Ctrl+. over the identifier span (cols 22..35 on line 2) for the TS2304.
    const fixes = await server.request<Array<{ fixName: string; description: string }>>("getCodeFixes", {
      file: MAIN,
      startLine: 2,
      startOffset: 22,
      endLine: 2,
      endOffset: 35,
      errorCodes: [2304],
    });
    expect(fixes.map((f) => f.description)).toContain('Add import from "./report.tsi"');
  });
});
