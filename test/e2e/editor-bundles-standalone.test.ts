// The shipped editor bundles must not resolve `typescript` from their own
// location: the VSIX stages dist/server.cjs and the tsserver plugin with NO
// node_modules/typescript beside them (packages/vscode/scripts/package.mjs),
// so a static `require("typescript")` anywhere in either bundle crashes the
// language server at load ("Cannot find module 'typescript'", every restart)
// and makes tsserver silently drop the plugin. Both bundles must take
// TypeScript from their host — the tsdk the client names, the module tsserver
// hands the plugin factory — and hand it to @nola-lang/derive (useTypeScript).
//
// This suite reproduces VS Code's layout OUTSIDE the repo, where the repo's
// node_modules cannot be reached by Node resolution: a copy of the TypeScript
// package as the tsdk / tsserver (VS Code's is under its own extensions dir),
// the server bundle on its own, and the plugin under a separate probe root.
// tsserver also probes three levels above its own executable — in the repo
// that is node_modules, where the workspace symlink to the in-repo plugin
// would win and hide the bug — so the copied tsserver is what makes the
// probe root decisive here.
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { type LanguageServerHandle, startLanguageServer } from "@volar/test-utils";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ensureBuilt } from "./helpers/ensure-built.js";
import { type TsDiagnostic, TsServerHandle } from "./helpers/tsserver.js";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const FIXTURE = join(ROOT, "examples", "cross-file-types");
const EXOTIC = join(FIXTURE, "src", "exotic.tsi");
const CONTENT = "export infer function f(.x: Map<string, number>) {\n  return ask ..`y`<Set<string>>;\n}\n";

let root: string;
let tsdk: string;
let serverBundle: string;
let pluginRoot: string;

beforeAll(async () => {
  await ensureBuilt(ROOT);
  root = mkdtempSync(join(tmpdir(), "nola-editor-bundles-"));
  // the editor's TypeScript, nowhere near the plugin or the server
  const tsPackage = join(root, "tsdk", "node_modules", "typescript");
  cpSync(join(ROOT, "node_modules", "typescript", "lib"), join(tsPackage, "lib"), { recursive: true });
  cpSync(join(ROOT, "node_modules", "typescript", "package.json"), join(tsPackage, "package.json"));
  tsdk = join(tsPackage, "lib");
  // the language server bundle, alone
  mkdirSync(join(root, "server", "dist"), { recursive: true });
  serverBundle = join(root, "server", "dist", "server.cjs");
  cpSync(join(ROOT, "packages", "language-server", "dist", "server.cjs"), serverBundle);
  // the plugin as the VSIX stages it: manifest (`main`) + bundle, nothing installed
  pluginRoot = join(root, "plugins");
  const plugin = join(pluginRoot, "node_modules", "@nola-lang", "typescript-plugin");
  mkdirSync(join(plugin, "dist"), { recursive: true });
  cpSync(join(ROOT, "packages", "typescript-plugin", "dist", "plugin.cjs"), join(plugin, "dist", "plugin.cjs"));
  writeFileSync(
    join(plugin, "package.json"),
    JSON.stringify({ name: "@nola-lang/typescript-plugin", version: "0.0.0", main: "./dist/plugin.cjs" }),
  );
}, 400_000);

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("editor bundles staged like the VSIX (no typescript beside them)", () => {
  it("neither bundle inlines the runtime (editors take findProjectRoot from the loader's runtime-free subpath)", () => {
    // The runtime claims its process-wide slot at import; an editor process
    // has no business holding one, and an inlined copy is dead weight that
    // also drags `import.meta.url` into a CJS bundle (esbuild: empty-import-meta).
    for (const bundle of [serverBundle, join(pluginRoot, "node_modules", "@nola-lang", "typescript-plugin", "dist", "plugin.cjs")]) {
      expect(readFileSync(bundle, "utf8"), bundle).not.toContain('Symbol.for("nola.runtime")');
    }
  });

  it("the language server starts on the client's tsdk and derives with it", { timeout: 120_000 }, async () => {
    const published = new Map<string, Array<{ code?: string | number; source?: string }>>();
    let server: LanguageServerHandle | undefined;
    try {
      server = startLanguageServer(serverBundle, FIXTURE);
      // a crashed server never answers `initialize`; fail on its exit instead of the test timeout
      const exited = new Promise<never>((_, reject) => {
        server?.process.on("exit", (code) => reject(new Error(`language server exited with code ${code}`)));
      });
      server.connection.onNotification(
        "textDocument/publishDiagnostics",
        (params: { uri: string; diagnostics: Array<{ code?: string | number; source?: string }> }) => {
          published.set(decodeURIComponent(params.uri).toLowerCase(), params.diagnostics);
        },
      );
      await Promise.race([server.initialize(pathToFileURL(FIXTURE).href, { typescript: { tsdk } }), exited]);
      const uri = pathToFileURL(EXOTIC).href;
      await server.openInMemoryDocument(uri, "nola", CONTENT);
      const key = decodeURIComponent(uri).toLowerCase();
      let diags: Array<{ code?: string | number; source?: string }> | undefined;
      for (let i = 0; i < 200 && !diags?.some((d) => d.code === "NOLA2002"); i++) {
        await Promise.race([new Promise((r) => setTimeout(r, 150)), exited]);
        diags = published.get(key);
      }
      expect(diags?.filter((d) => d.source === "nola").map((d) => d.code).sort()).toEqual(["NOLA2002", "NOLA2008"]);
    } finally {
      await server?.shutdown().catch(() => undefined);
      server?.process.kill();
    }
  });

  it("tsserver loads the plugin from the probe root and it derives with tsserver's TypeScript", { timeout: 120_000 }, async () => {
    const server = new TsServerHandle(join(tsdk, "tsserver.js"), pluginRoot);
    try {
      server.send("open", { file: EXOTIC, projectRootPath: FIXTURE, fileContent: CONTENT });
      const diags = await server.request<TsDiagnostic[]>("semanticDiagnosticsSync", { file: EXOTIC });
      server.send("close", { file: EXOTIC });
      const nola = diags.filter((d) => String(d.text).includes("NOLA"));
      expect(nola.map((d) => d.code).sort()).toEqual([2002, 2008]);
    } finally {
      server.kill();
    }
  });
});
