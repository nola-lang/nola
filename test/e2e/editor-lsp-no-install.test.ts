// A scaffold opened BEFORE `npm install` (the window between `npm create nola`
// and the install, or a bare .tsi on its own): `@nola-lang/runtime` does not
// resolve, so the lowered appendix import fails — and because the appendix is
// unmapped, the only thing that used to reach the editor was the derivative
// "Parameter '__frame' implicitly has an 'any' type" (TS7006) on the infer
// function header. The language server now serves the compiler's ambient stub
// for the runtime when it does not resolve (the same fallback `nola check`
// uses in bare projects), so the file is clean and fully typed.
//
// The fixture is COPIED to a temp dir: inside this monorepo every directory
// resolves `@nola-lang/runtime` through the root node_modules, which would
// defeat the scenario.
import { cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { type LanguageServerHandle, startLanguageServer } from "@volar/test-utils";
import ts from "typescript";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ensureBuilt } from "./helpers/ensure-built.js";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const FIXTURE = join(ROOT, "test", "e2e", "fixtures", "no-install");
const SERVER = join(ROOT, "packages", "language-server", "dist", "server.cjs");
const TSDK = join(ROOT, "node_modules", "typescript", "lib");

interface LspDiagnostic {
  code?: string | number;
  source?: string;
  message?: string;
  range: { start: { line: number; character: number }; end: { line: number; character: number } };
}

let project: string;
let server: LanguageServerHandle;
const published = new Map<string, LspDiagnostic[] | undefined>();

function positionOf(text: string, needle: string, offsetInNeedle = 0): { line: number; character: number } {
  const index = text.indexOf(needle) + offsetInNeedle;
  if (index < offsetInNeedle) throw new Error(`needle not found: ${needle}`);
  const before = text.slice(0, index);
  return { line: before.split("\n").length - 1, character: index - (before.lastIndexOf("\n") + 1) };
}

async function waitForPublished(uri: string): Promise<LspDiagnostic[]> {
  const key = decodeURIComponent(uri).toLowerCase();
  for (let i = 0; i < 200; i++) {
    const diags = published.get(key);
    if (diags) return diags;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`timed out waiting for diagnostics of ${uri}`);
}

beforeAll(async () => {
  await ensureBuilt(ROOT);
  project = mkdtempSync(join(tmpdir(), "nola-no-install-"));
  cpSync(FIXTURE, project, { recursive: true });
  // Precondition: nothing above the temp dir provides the runtime — otherwise
  // this test would silently exercise the installed-package path.
  const probe = ts.resolveModuleName(
    "@nola-lang/runtime",
    join(project, "src", "probe.ts"),
    { moduleResolution: ts.ModuleResolutionKind.Bundler },
    ts.sys,
  );
  expect(probe.resolvedModule, "the temp fixture must NOT resolve @nola-lang/runtime").toBeUndefined();

  server = startLanguageServer(SERVER, project);
  server.connection.onNotification(
    "textDocument/publishDiagnostics",
    (params: { uri: string; diagnostics: LspDiagnostic[] }) => {
      published.set(decodeURIComponent(params.uri).toLowerCase(), params.diagnostics);
    },
  );
  await server.initialize(pathToFileURL(project).href, { typescript: { tsdk: TSDK } });
}, 400_000);

afterAll(async () => {
  await server?.shutdown();
  if (server) {
    // The server's cwd is the temp project: wait for the process to be gone
    // before deleting it (Windows reports EBUSY otherwise), bounded.
    const exited = new Promise<void>((resolve) => server.process.once("exit", () => resolve()));
    server.process.kill();
    await Promise.race([exited, new Promise<void>((resolve) => setTimeout(resolve, 5_000))]);
  }
  if (project) rmSync(project, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
});

describe("LSP over a scaffold that has not run `npm install`", () => {
  it("publishes NO diagnostics for the starter's person.tsi (no TS7006 on the infer header)", async () => {
    const file = join(project, "src", "person.tsi");
    const doc = await server.openTextDocument(file, "nola");
    const diags = await waitForPublished(doc.uri);
    expect(diags.map((d) => `${d.code}: ${d.message}`)).toEqual([]);
  });

  it("still types the ask result — hover on `person` shows Person", async () => {
    const file = join(project, "src", "person.tsi");
    const text = readFileSync(file, "utf8");
    const doc = await server.openTextDocument(file, "nola");
    const hover = await server.sendHoverRequest(doc.uri, positionOf(text, "const person", "const ".length));
    expect(JSON.stringify(hover?.contents ?? "")).toContain("Person");
  });

  it("a real type error in the .tsi is still reported (the stub does not mask the program)", async () => {
    const content = [
      "export infer function go(q: string) {",
      "  const s: string = ask ..`n`<number>;",
      "  return s;",
      "}",
      "",
    ].join("\n");
    const uri = pathToFileURL(join(project, "src", "bad.tsi")).href;
    await server.openInMemoryDocument(uri, "nola", content);
    const key = decodeURIComponent(uri).toLowerCase();
    let diags: LspDiagnostic[] | undefined;
    for (let i = 0; i < 200; i++) {
      diags = published.get(key);
      if (diags?.some((d) => d.code === 2322)) break;
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    const mismatch = diags?.find((d) => d.code === 2322);
    expect(mismatch?.range.start.line).toBe(1);
    expect(diags?.some((d) => d.code === 7006)).toBe(false);
  });
});
