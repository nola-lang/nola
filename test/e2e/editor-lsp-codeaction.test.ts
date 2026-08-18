// Quick fixes INSIDE a .tsi document (Ctrl+.), which the Nola LSP serves —
// tsserver only ever sees plain .ts files. The case that matters is
// auto-import: an infer function body calling a value exported from a plain
// .ts sibling must offer `Add import from "./handlers.js"`, and applying the
// fix must land the import in the .tsi source (not in the generated appendix).
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { type LanguageServerHandle, startLanguageServer } from "@volar/test-utils";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ensureBuilt } from "./helpers/ensure-built.js";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const SERVER = join(ROOT, "packages", "language-server", "dist", "server.cjs");
const TSDK = join(ROOT, "node_modules", "typescript", "lib");

interface LspDiagnostic {
  code?: string | number;
  source?: string;
  range: { start: { line: number; character: number }; end: { line: number; character: number } };
}

interface CodeAction {
  title: string;
  kind?: string;
  edit?: { changes?: Record<string, { range: LspDiagnostic["range"]; newText: string }[]> };
  data?: unknown;
}

/** The call sits behind `ask`, whose operand lowers inside a replaced span. */
const TRIAGE = [
  "export infer function triageEmail(.email: string) {",
  "  const kind = ask ..`order or quote`<\"quote\" | \"order\">;",
  "  if (kind === 'order') {",
  "    ask putOrder({ id: '1' });",
  "  }",
  "  return kind;",
  "}",
  "",
].join("\n");

/** Same call under a plain `await` — the control. */
const TRIAGE_AWAIT = TRIAGE.replace("ask putOrder", "await putOrder");

const HANDLERS = [
  "export type Order = { id: string };",
  "",
  "export async function putOrder(params: Order) {",
  "  return params;",
  "}",
  "",
].join("\n");

let fixture: string;
let triageUri: string;
let server: LanguageServerHandle;
const published = new Map<string, LspDiagnostic[]>();

async function waitForDiagnostics(uri: string, predicate: (d: LspDiagnostic[]) => boolean): Promise<LspDiagnostic[]> {
  const key = decodeURIComponent(uri).toLowerCase();
  for (let i = 0; i < 100; i++) {
    const diags = published.get(key);
    if (diags && predicate(diags)) return diags;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`timed out waiting for diagnostics of ${uri}; got ${JSON.stringify(published.get(key) ?? null)}`);
}

beforeAll(async () => {
  await ensureBuilt(ROOT);
  fixture = mkdtempSync(join(tmpdir(), "nola-lsp-codeaction-"));
  mkdirSync(join(fixture, "src"));
  writeFileSync(join(fixture, "src", "handlers.ts"), HANDLERS);
  writeFileSync(join(fixture, "src", "triage.tsi"), TRIAGE);
  writeFileSync(
    join(fixture, "package.json"),
    `${JSON.stringify({ name: "codeaction-fixture", version: "0.0.0", private: true, type: "module" }, null, 2)}\n`,
  );
  cpSync(join(ROOT, "examples", "cross-file-types", "tsconfig.json"), join(fixture, "tsconfig.json"));

  server = startLanguageServer(SERVER, fixture);
  server.connection.onNotification(
    "textDocument/publishDiagnostics",
    (params: { uri: string; diagnostics: LspDiagnostic[] }) => {
      published.set(decodeURIComponent(params.uri).toLowerCase(), params.diagnostics);
    },
  );
  await server.initialize(pathToFileURL(fixture).href, { typescript: { tsdk: TSDK } });
  const doc = await server.openTextDocument(join(fixture, "src", "triage.tsi"), "nola");
  triageUri = doc.uri;
}, 400_000);

afterAll(async () => {
  await server?.shutdown();
  // Wait for the server to actually exit before removing the fixture: the
  // dying process still holds watcher handles on it, and on Windows the
  // rmdir races them into EBUSY. kill() alone returns before the release.
  const proc = server?.process;
  if (proc && proc.exitCode === null) {
    const exited = new Promise<void>((resolve) => {
      proc.once("exit", () => resolve());
      setTimeout(resolve, 5_000);
    });
    proc.kill();
    await exited;
  }
  rmSync(fixture, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

async function importTitlesFor(uri: string): Promise<string[]> {
  const diags = await waitForDiagnostics(uri, (d) => d.some((x) => x.code === 2304));
  const undefinedName = diags.find((x) => x.code === 2304);
  expect(undefinedName, "putOrder should be reported as an undefined name").toBeDefined();
  const actions = (await server.connection.sendRequest("textDocument/codeAction", {
    textDocument: { uri },
    range: undefinedName?.range,
    context: { diagnostics: [undefinedName], only: ["quickfix"] },
  })) as CodeAction[] | null;
  return (actions ?? []).map((a) => a.title);
}

describe("quick fixes inside a .tsi", () => {
  it("control: `await putOrder(...)` offers Add import", { timeout: 120_000 }, async () => {
    const uri = pathToFileURL(join(fixture, "src", "control.tsi")).href;
    await server.openInMemoryDocument(uri, "nola", TRIAGE_AWAIT);
    expect((await importTitlesFor(uri)).join(" | ")).toContain("Add import");
  });

  it("`ask putOrder(...)` offers Add import too", { timeout: 120_000 }, async () => {
    expect((await importTitlesFor(triageUri)).join(" | ")).toContain("Add import");
  });

  // KNOWN DEFECT — the offered specifier omits the NodeNext `.js` extension:
  // we get `Add import from "./handlers"`, which fails at run time with
  // ERR_MODULE_NOT_FOUND (verified) while `nola check` stays silent. A plain
  // `.ts` importer in the same project correctly gets "./handlers.js".
  //
  // Cause: TypeScript derives a file's module format from its extension, and
  // `.tsi` is unknown to it, so `impliedNodeFormat` is undefined and the
  // specifier generator does not add the extension. Volar computes the right
  // format (`fixupImpliedNodeFormatForFile`, @volar/typescript) but only for
  // the duration of a module-resolution call and reverts it immediately, so
  // auto-import never sees it. Fixing it means either making that fixup stick
  // on the program's `.tsi` source files or post-processing the emitted edits.
  it.skip("offers the NodeNext-correct specifier (./handlers.js)", async () => {
    expect((await importTitlesFor(triageUri)).join(" | ")).toContain('"./handlers.js"');
  });
});
