// Track 3 acceptance (spec §7a, protocol-level): diagnostics (TS-mapped +
// nola-native), hover, completion, go-to-definition against the REAL
// examples/cross-file-types project — same resolution the dogfood editor uses.
//
// The server uses PUSH diagnostics (volar-service-typescript declares
// interFileDependencies, which disables Volar's pull-diagnostics mode), so
// tests collect textDocument/publishDiagnostics notifications.
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { type LanguageServerHandle, startLanguageServer } from "@volar/test-utils";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ensureBuilt } from "./helpers/ensure-built.js";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const FIXTURE = join(ROOT, "examples", "cross-file-types");
const SERVER = join(ROOT, "packages", "language-server", "dist", "server.cjs");
const TSDK = join(ROOT, "node_modules", "typescript", "lib");
const REPORT_PATH = join(FIXTURE, "src", "report.tsi");

interface LspDiagnostic {
  code?: string | number;
  source?: string;
  range: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
}

interface LspTextEdit {
  range: { start: { line: number; character: number }; end: { line: number; character: number } };
  newText: string;
}

function applyEdits(text: string, edits: LspTextEdit[]): string {
  const lineStarts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === "\n") lineStarts.push(i + 1);
  const toOffset = (p: { line: number; character: number }) => (lineStarts[p.line] ?? text.length) + p.character;
  const sorted = [...edits].sort((a, b) => toOffset(b.range.start) - toOffset(a.range.start));
  let out = text;
  for (const edit of sorted) {
    out = out.slice(0, toOffset(edit.range.start)) + edit.newText + out.slice(toOffset(edit.range.end));
  }
  return out;
}

function positionOf(text: string, needle: string, offsetInNeedle = 0): { line: number; character: number } {
  const index = text.indexOf(needle) + offsetInNeedle;
  if (index < offsetInNeedle) throw new Error(`needle not found: ${needle}`);
  const before = text.slice(0, index);
  return { line: before.split("\n").length - 1, character: index - (before.lastIndexOf("\n") + 1) };
}

let server: LanguageServerHandle;
const published = new Map<string, LspDiagnostic[]>();
// Dynamic registrations the server asks the client for (VS Code turns a
// DidChangeWatchedFiles registration into FileSystemWatchers).
const watcherGlobs: string[] = [];
const FRESH_PATH = join(FIXTURE, "src", "fresh-on-disk.tsi");
const CASED_PATH = join(FIXTURE, "src", "cased-on-disk.tsi");

/**
 * A completion request as VS Code sends it when the user types a ".": trigger
 * kind 2 with the character. TypeScript treats that differently from an
 * invoked (Ctrl+Space) request — it only answers when a dot really precedes
 * the position — so the trigger context is load-bearing for marker tests.
 */
async function completionOnDotTrigger(uri: string, position: { line: number; character: number }): Promise<string[]> {
  const result = (await server.connection.sendRequest("textDocument/completion", {
    textDocument: { uri },
    position,
    context: { triggerKind: 2, triggerCharacter: "." },
  })) as { items: { label: string }[] } | null;
  return (result?.items ?? []).map((i) => i.label);
}

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
  server = startLanguageServer(SERVER, FIXTURE);
  server.connection.onNotification(
    "textDocument/publishDiagnostics",
    (params: { uri: string; diagnostics: LspDiagnostic[] }) => {
      published.set(decodeURIComponent(params.uri).toLowerCase(), params.diagnostics);
    },
  );
  server.connection.onRequest(
    "client/registerCapability",
    (params: { registrations: { method: string; registerOptions?: { watchers?: { globPattern: string }[] } }[] }) => {
      for (const r of params.registrations) {
        if (r.method === "workspace/didChangeWatchedFiles") {
          for (const w of r.registerOptions?.watchers ?? []) watcherGlobs.push(String(w.globPattern));
        }
      }
      return null;
    },
  );
  // What VS Code's client advertises: the server may register file watchers.
  await server.initialize(
    pathToFileURL(FIXTURE).href,
    { typescript: { tsdk: TSDK } },
    { workspace: { didChangeWatchedFiles: { dynamicRegistration: true } } },
  );
}, 400_000);

afterAll(async () => {
  await server?.shutdown();
  server?.process.kill();
  rmSync(FRESH_PATH, { force: true });
  rmSync(CASED_PATH, { force: true });
});

describe("LSP over examples/cross-file-types", () => {
  it("a .tsi created on disk after startup joins the tsconfig project (no TS1378 on a top-level ask)", async () => {
    // Volar re-parses a tsconfig's file list only on a watched-file event.
    // A file the user creates in the Explorer exists on disk before it is
    // opened, so the unsaved-document path never re-parses either: without
    // a registered watcher for *.tsi the file lands in Volar's INFERRED
    // project (module CommonJS, target ES2020) and a top-level ask reports
    // TS1378 until the window is reloaded.
    // The tsconfig project must already exist (its file list was parsed
    // BEFORE the new file), as it does in a running editor.
    const warm = await server.openTextDocument(REPORT_PATH, "nola");
    await waitForDiagnostics(warm.uri, () => true);
    const content = ["const n: number = \"x\";", "const a = ask `hello`<string>;", "console.log(a, n);", ""].join("\n");
    writeFileSync(FRESH_PATH, content);
    const uri = pathToFileURL(FRESH_PATH).href;
    await server.connection.sendNotification("workspace/didChangeWatchedFiles", { changes: [{ uri, type: 1 }] });
    await server.openTextDocument(FRESH_PATH, "nola");
    // 2322 proves the TS semantic pass ran on this document.
    const diags = await waitForDiagnostics(uri, (d) => d.some((x) => x.code === 2322));
    expect(diags.map((d) => d.code)).not.toContain(1378);
    expect(watcherGlobs.some((g) => g.includes("tsi"))).toBe(true);
  });

  it("maps a TS type error into .tsi coordinates", async () => {
    const content = [
      "export infer function go(q: string) {",
      "  const s: string = ask ..`n`<number>;",
      "  return s;",
      "}",
      "",
    ].join("\n");
    const uri = pathToFileURL(join(FIXTURE, "src", "bad.tsi")).href;
    await server.openInMemoryDocument(uri, "nola", content);
    const diags = await waitForDiagnostics(uri, (d) => d.some((x) => x.code === 2322));
    const mismatch = diags.find((d) => d.code === 2322);
    expect(mismatch?.range.start.line).toBe(1);
  });

  it("publishes nola-native diagnostics (source 'nola')", async () => {
    const uri = pathToFileURL(join(FIXTURE, "src", "scratch.tsi")).href;
    await server.openInMemoryDocument(uri, "nola", "const p = ..5;\n");
    const diags = await waitForDiagnostics(uri, (d) => d.some((x) => x.source === "nola" && x.code === "NOLA1005"));
    const nola = diags.find((d) => d.source === "nola" && d.code === "NOLA1005");
    expect(nola).toBeDefined();
  });

  // `ask `p`;<T>` — the `;` slipped in before the type args, leaving a `<T>`
  // type assertion with no operand at the end of the file. This used to bail
  // the whole parse: the editor served last-good output whose mappings no
  // longer matched the text (semantic tokens painted a type name over the
  // middle of the prompt) and the parse error, sitting past those mappings'
  // extent, was never published. Now the parser recovers a missing
  // expression and the error is reported on the ask line, right after `>`.
  it("reports an expression missing at the end of the file on the line it belongs to", async () => {
    const content = "type T = { a: string }\nconst r = ask `p`;<T>\n\n";
    const uri = pathToFileURL(join(FIXTURE, "src", "eof.tsi")).href;
    await server.openInMemoryDocument(uri, "nola", content);
    const diags = await waitForDiagnostics(uri, (d) => d.some((x) => x.source === "nola" && x.code === "NOLA1001"));
    const nola = diags.find((d) => d.source === "nola" && d.code === "NOLA1001");
    expect(nola?.range.start).toEqual(positionOf(content, "<T>", 3));
  });

  // The same slip with the file continuing after it — `;<T>;` and another
  // statement below. The first recovery was EOF-only, so this state bailed
  // (a null AST, stale last-good output) on every keystroke until the `;` was
  // removed. Now the missing operand is recovered before the `;` and the
  // statements below it still lower: completion after `console.` on the next
  // line is TypeScript's member list, not the global scope of a stale program.
  it("reports an expression missing before a `;` mid-file and keeps parsing the rest", async () => {
    const content = "type T = { a: string }\nconst r = ask `p`;<T>;\nconsole.\n";
    const uri = pathToFileURL(join(FIXTURE, "src", "mid-file.tsi")).href;
    await server.openInMemoryDocument(uri, "nola", content);
    const diags = await waitForDiagnostics(uri, (d) => d.some((x) => x.source === "nola" && x.code === "NOLA1001"));
    const nola = diags.find((d) => d.source === "nola" && d.code === "NOLA1001");
    expect(nola?.range.start).toEqual(positionOf(content, "<T>;", 3));
    const completion = await server.sendCompletionRequest(uri, positionOf(content, "console.", 8));
    const labels = new Set((completion?.items ?? []).map((i) => i.label));
    expect(labels.has("log")).toBe(true);
    expect(labels.has("__nola")).toBe(false);
  });

  // `console.` typed as the LAST thing in the file: the appendix begins right
  // after it, and TypeScript used to read `console.` + newline + `import {
  // __nola }` as the property access `console.import` — the runtime import
  // vanished and "Cannot find name '__nola'" landed on the ask site. The
  // appendix now opens with `;`. Completion after the dot is TypeScript's own
  // member list either way (the dangling access is kept verbatim).
  it("a dangling `console.` at the end of the file keeps the appendix import (no TS2304 on the ask)", async () => {
    const content = "const person = ask `the person`<{ name: string }>;\nconsole\n";
    const uri = pathToFileURL(join(FIXTURE, "src", "dangling.tsi")).href;
    await server.openInMemoryDocument(uri, "nola", content);
    await waitForDiagnostics(uri, (d) => d.some((x) => x.code === 6133));
    const dot = { line: 1, character: "console".length };
    await server.updateTextDocument(uri, [{ range: { start: dot, end: dot }, newText: "." }]);
    const labels = await completionOnDotTrigger(uri, { line: 1, character: "console.".length });
    expect(labels).toContain("log");
    expect(labels).not.toContain("__nola");
    // the semantic pass over the edited text: 6133 (person unused) proves it ran
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const diags = await waitForDiagnostics(uri, (d) => d.some((x) => x.code === 6133));
    expect(diags.map((d) => d.code)).not.toContain(2304);
  });

  // Volar looks an open document up by the exact string of its URI. When the
  // editor's spelling of a file differs from the tsconfig's only in case (a
  // folder opened as `d:/Work/...` on a `d:/work/...` disk), the project's
  // sync misses the open document under the tsconfig spelling and reads the
  // file from DISK: the program TypeScript answers from lags the editor by
  // one autosave while the mappings follow the editor. A `.` typed after
  // `console` was then answered at a position where the program had no dot —
  // the whole global scope (`__nola`, `__nola_file_ctx`, ...) — and the
  // derivation pass flashed errors under <T>. The server now falls back to a
  // case-insensitive lookup on case-insensitive file systems.
  it("a document opened under a differently cased URI still completes against the editor's text", async () => {
    const onDisk = "const person = ask `the person`<{ name: string }>;\nconsole\n";
    writeFileSync(CASED_PATH, onDisk);
    const real = pathToFileURL(CASED_PATH).href;
    await server.connection.sendNotification("workspace/didChangeWatchedFiles", { changes: [{ uri: real, type: 1 }] });
    const odd = real.replace(/\/examples\//, "/EXAMPLES/").replace(/\/src\//, "/SRC/");
    expect(odd).not.toBe(real);
    await server.openInMemoryDocument(odd, "nola", onDisk);
    await waitForDiagnostics(odd, (d) => d.some((x) => x.code === 6133));
    // the editor moves on; the disk copy stays behind (no autosave yet)
    const dot = { line: 1, character: "console".length };
    await server.updateTextDocument(odd, [{ range: { start: dot, end: dot }, newText: "." }]);
    await server.sendSemanticTokensRequest(odd);
    const labels = await completionOnDotTrigger(odd, { line: 1, character: "console.".length });
    expect(labels).toContain("log");
    expect(labels).not.toContain("__nola");
  });

  it("hover inside .tsi shows the inferred Person type", async () => {
    const text = readFileSync(REPORT_PATH, "utf8");
    const doc = await server.openTextDocument(REPORT_PATH, "nola");
    const hover = await server.sendHoverRequest(doc.uri, positionOf(text, "const person", "const ".length));
    const rendered = JSON.stringify(hover?.contents ?? "");
    expect(rendered).toContain("Person");
  });

  it("go-to-definition on the imported type lands in models.ts", async () => {
    const text = readFileSync(REPORT_PATH, "utf8");
    const doc = await server.openTextDocument(REPORT_PATH, "nola");
    const defs = await server.sendDefinitionRequest(doc.uri, positionOf(text, "{ Person }", 2));
    const list = Array.isArray(defs) ? defs : defs ? [defs] : [];
    expect(list.length).toBeGreaterThan(0);
    const target = (list[0] ?? {}) as { targetUri?: string; uri?: string };
    expect(String(target.targetUri ?? target.uri)).toContain("models.ts");
  });

  it("go-to-definition on `<Person>` at the ask site lands in models.ts (anchor mapping)", async () => {
    // The <T> span is inside a REPLACED region, but its bytes are copied
    // verbatim into the generated ExtractIntent<T> — the anchor mapping makes
    // navigation work there.
    const text = readFileSync(REPORT_PATH, "utf8");
    const doc = await server.openTextDocument(REPORT_PATH, "nola");
    const defs = await server.sendDefinitionRequest(doc.uri, positionOf(text, "<Person>;", 3));
    const list = Array.isArray(defs) ? defs : defs ? [defs] : [];
    expect(list.length).toBeGreaterThan(0);
    const target = (list[0] ?? {}) as { targetUri?: string; uri?: string };
    expect(String(target.targetUri ?? target.uri)).toContain("models.ts");
  });

  it("format document re-indents source lines (verbatim spans map formatter edits back)", async () => {
    const content = [
      "export infer function fmt(q: string) {",
      "  const s = ask ..`n`<string>;",
      "for  (const c of q) {",
      "  }",
      "  return s;",
      "}",
      "",
    ].join("\n");
    const uri = pathToFileURL(join(FIXTURE, "src", "format.tsi")).href;
    await server.openInMemoryDocument(uri, "nola", content);
    const edits = (await server.sendDocumentFormattingRequest(uri, { tabSize: 2, insertSpaces: true })) ?? [];
    const formatted = applyEdits(content, edits);
    expect(formatted).toContain("\n  for (const c of q) {");
    // the nola construct is untouched — formatting runs on the source text
    // and drops edits that overlap replaced spans
    expect(formatted).toContain("  const s = ask ..`n`<string>;");
  });

  it("a tagged infer function's semantic token covers the name only, not the instruction", async () => {
    // The lowering DELETES the instruction from the header, so the generated
    // offset at the end of the name is also the offset at the start of `(`.
    // If the mapping lets a range's end land on the next span, the `function`
    // semantic token stretches over the instruction and VS Code paints the
    // prose function-yellow instead of string.
    const content = [
      "export infer function getUserById`get user from this userData`(.userData: string) {",
      "  return 1;",
      "}",
      "",
      "export infer function getUserById_3`get user from this userData`(.userData: string) {",
      "  return 2;",
      "}",
      "",
    ].join("\n");
    const uri = pathToFileURL(join(FIXTURE, "src", "semantic.tsi")).href;
    await server.openInMemoryDocument(uri, "nola", content);
    const tokens = await server.sendSemanticTokensRequest(uri);
    const data = tokens?.data ?? [];
    const lines = content.split("\n");

    // decode LSP's delta encoding into the source text each token covers
    const covered: string[] = [];
    let line = 0;
    let char = 0;
    for (let i = 0; i < data.length; i += 5) {
      const [dLine, dChar, len] = [data[i] as number, data[i + 1] as number, data[i + 2] as number];
      line += dLine;
      char = dLine === 0 ? char + dChar : dChar;
      covered.push((lines[line] ?? "").slice(char, char + len));
    }

    // BOTH functions: the token is the bare name; no token swallows the prose
    expect(covered).toContain("getUserById");
    expect(covered).toContain("getUserById_3");
    expect(covered.filter((t) => t.includes("get user from this userData"))).toEqual([]);
  });

  it("quick fix on an unimported <T> offers the missing import", async () => {
    const content = [
      "export infer function extractPerson(text: string) {",
      // biome-ignore lint/suspicious/noTemplateCurlyInString: literal ${...} in .tsi fixture source
      "  const person = ask ..`the person described in: ${text}`<Person>;",
      "  return person;",
      "}",
      "",
    ].join("\n");
    const uri = pathToFileURL(join(FIXTURE, "src", "unimported.tsi")).href;
    await server.openInMemoryDocument(uri, "nola", content);
    // Volar publishes per plugin as each finishes: the nola pass can land
    // before TypeScript's semantic pass, and a code-action request carrying
    // only NOLA2002 gets no import fix (the fix is computed for TS2304). Wait
    // for the TS diagnostic itself, as VS Code's Ctrl+. would carry it.
    const diags = await waitForDiagnostics(uri, (d) => d.some((x) => x.code === 2304));

    // Mimic VS Code's Ctrl+.: request at the Person range with the published
    // diagnostics that overlap it as context.
    const start = positionOf(content, "<Person>", 1);
    const end = { line: start.line, character: start.character + "Person".length };
    const overlapping = diags.filter(
      (d) =>
        d.range.start.line === start.line &&
        d.range.start.character <= end.character &&
        d.range.end.character >= start.character,
    );
    const actions = await server.sendCodeActionsRequest(
      uri,
      { start, end },
      { diagnostics: overlapping as never[] },
    );
    const importAction = (actions ?? []).find((a) => (a as { title: string }).title.includes("models")) as
      | {
          title: string;
          edit?: {
            documentChanges?: Array<{
              textDocument?: { uri: string };
              edits?: Array<{ newText: string; range: { start: { line: number; character: number } } }>;
            }>;
          };
        }
      | undefined;
    expect(importAction?.title).toContain('Add import from "./models');
    // the edit must land in the SOURCE .tsi, at the top of the file — never
    // inside the (unmapped) generated appendix
    const change = importAction?.edit?.documentChanges?.[0];
    expect(decodeURIComponent(change?.textDocument?.uri ?? "")).toContain("unimported.tsi");
    expect(change?.textDocument?.uri ?? "").not.toContain("volar-embedded-content");
    const edit = change?.edits?.[0];
    expect(edit?.newText).toContain("import { Person }");
    expect(edit?.range.start).toEqual({ line: 0, character: 0 });
  });

  it("completion on a raw intent shows only the public Askable surface", async () => {
    const content = [
      "export infer function raw(t: string) {",
      "  const user = ..`get user`<string>;",
      "  user.",
      "  return user;",
      "}",
      "",
    ].join("\n");
    const uri = pathToFileURL(join(FIXTURE, "src", "rawintent.tsi")).href;
    await server.openInMemoryDocument(uri, "nola", content);
    const pos = positionOf(content, "  user.", "  user.".length);
    const completions = await server.sendCompletionRequest(uri, pos);
    const labels = completions?.items.map((i) => i.label) ?? [];
    expect(labels).toContain("withRetry");
    expect(labels).toContain("withModel");
    expect(labels).toContain("withParams");
    expect(labels).toContain("withTimeout");
    // internals and the stack-frame opt-out must not leak into the narrow tier
    for (const internal of ["__nolaBrand", "then", "run", "spec", "reviveValue", "detached"]) {
      expect(labels).not.toContain(internal);
    }
    // the phantom type anchor must not surface as a bracket completion either
    expect(labels.filter((l) => l.includes("IntentOutput"))).toEqual([]);
  });

  it("completion on a type value shows only the public InferType surface", async () => {
    // emit 14: `export interface User` also exports the value `User`, cast to
    // `InferType<User>` — an interface of exactly four members. The runtime's
    // carrier class (brand, node, describe/refName/revive/toTypeText/…) is what
    // the extractor path uses and must never reach the user's suggestion widget.
    const content = ["export interface User {", "  name: string;", "}", "User.", ""].join("\n");
    const uri = pathToFileURL(join(FIXTURE, "src", "typevalue.tsi")).href;
    await server.openInMemoryDocument(uri, "nola", content);
    const labels = await completionOnDotTrigger(uri, positionOf(content, "User.", "User.".length));
    expect(labels).toEqual(expect.arrayContaining(["toJsonSchema", "validate", "parse", "~standard"]));
    for (const internal of [
      "__nolaTypeBrand",
      "_node",
      "_description",
      "describe",
      "refName",
      "revive",
      "toNativeType",
      "toString",
      "toTypeText",
    ]) {
      expect(labels).not.toContain(internal);
    }
  });

  it("an underivable type publishes a nola diagnostic from the lazy checker pass (emit 15)", async () => {
    // The embedded code is phase-1 output (inert accessors): derivation runs
    // on the diagnostics pass against the live program and lands at the
    // source range of the type node.
    const content = "export infer function f(.x: Map<string, number>) {\n  return ask ..`y`<Set<string>>;\n}\n";
    const uri = pathToFileURL(join(FIXTURE, "src", "exotic.tsi")).href;
    await server.openInMemoryDocument(uri, "nola", content);
    const diags = await waitForDiagnostics(uri, (d) => d.some((x) => x.source === "nola" && x.code === "NOLA2002"));
    const extract = diags.find((x) => x.code === "NOLA2002");
    expect(extract?.message).toContain("Set<string>");
    expect(extract?.range.start).toEqual(positionOf(content, "Set<string>"));
    expect(extract?.range.end).toEqual(positionOf(content, "Set<string>", "Set<string>".length));
    const context = diags.find((x) => x.code === "NOLA2008");
    expect(context?.message).toContain("Map<string, number>");
    expect(context?.range.start).toEqual(positionOf(content, "Map<string, number>"));
  });

  // Typing `..` used to pull the entire global scope into the suggestion
  // widget: after the first dot the file failed to parse and the editor served
  // stale lowered output (1107 items), and after the second dot the marker's
  // own bytes survived into the generated TS (3142 items). VS Code auto-triggers
  // on "." — hence the explicit trigger context, which is what TypeScript uses
  // to decide whether a completion is meaningful at all.
  for (const marker of [".", ".."]) {
    it(`a half-typed \`ask ${marker}\` marker offers no completions`, async () => {
      const content = [
        "export infer function typing(t: string) {",
        `  const x = ask ${marker}`,
        "  return x;",
        "}",
        "",
      ].join("\n");
      const uri = pathToFileURL(join(FIXTURE, "src", `marker${marker.length}.tsi`)).href;
      await server.openInMemoryDocument(uri, "nola", content);
      const items = await completionOnDotTrigger(uri, positionOf(content, `ask ${marker}`, `ask ${marker}`.length));
      expect(items).toEqual([]);
    });
  }

  // Prompt templates: `${.` inside an infer-function marker is a scope access
  // (spec 2026-08-17). The marker is copied into the wrapper closer with anchor
  // mappings, so a `.`-triggered completion after `${.` must answer with the
  // FunctionPromptScope members — and only those, never the global scope.
  it("completion after `${.` inside an infer-function marker lists the prompt scope", async () => {
    // VS Code auto-closes the brace, so the keystroke state is `${.}` with the
    // cursor after the dot — the NOLA1015 recovery placeholder.
    const head = "export infer function tpl`CTX ${.";
    const content = [`${head}}\`(t: string) {`, "  return t;", "}", ""].join("\n");
    const uri = pathToFileURL(join(FIXTURE, "src", "markertpl.tsi")).href;
    await server.openInMemoryDocument(uri, "nola", content);
    const labels = await completionOnDotTrigger(uri, { line: 0, character: head.length });
    for (const m of ["args", "signature", "fn", "next", "default", "nested", "hasContext"]) expect(labels).toContain(m);
    expect(labels).not.toContain("console");
  });

  it("completion after `${.` inside an extractor lists the extract scope", async () => {
    // biome-ignore lint/suspicious/noTemplateCurlyInString: literal ${...} in .tsi fixture source
    const content = ["export infer function tplx(t: string) {", "  const v = ask ..`x ${.}`<string>;", "  return v;", "}", ""].join(
      "\n",
    );
    const uri = pathToFileURL(join(FIXTURE, "src", "extracttpl.tsi")).href;
    await server.openInMemoryDocument(uri, "nola", content);
    const labels = await completionOnDotTrigger(uri, positionOf(content, "ask ..`x ${.", "ask ..`x ${.".length));
    for (const m of ["type", "schema", "format", "default", "hasContext"]) expect(labels).toContain(m);
    expect(labels).not.toContain("console");
  });

  // Both marker sites, typed keystroke by keystroke into a file that was valid
  // a moment ago — the state the bogus popup actually appeared in.
  const typingCases = [
    {
      what: "an `ask` marker",
      good: ["export infer function typed(t: string) {", "", "  return 1;", "}", ""],
      at: { line: 1, character: 0 },
      text: "  const x = ask ..",
    },
    {
      what: "a module-level marker",
      good: ["const a = 1;", "", "export const b = 2;", ""],
      at: { line: 1, character: 0 },
      text: "const x = ..",
    },
    // The third marker site: a `.` context parameter, typed between the
    // parens of a function that already had none. The lone dot leaves the
    // parameter list with nothing to bind; the parser recovers it into a
    // placeholder so the file keeps lowering instead of bailing.
    {
      what: "a context parameter marker",
      good: ["export infer function typedParam() {", "  return 1;", "}", ""],
      at: { line: 0, character: "export infer function typedParam(".length },
      text: ".q",
    },
  ];
  for (const { what, good: goodLines, at: start, text } of typingCases) {
    it(`${what} typed into a previously valid file offers no completions`, async () => {
      const good = goodLines.join("\n");
      const uri = pathToFileURL(join(FIXTURE, "src", `marker-typed-${text.length}.tsi`)).href;
      await server.openInMemoryDocument(uri, "nola", good);
      // Wait for the good text to be compiled: only then does a later
      // unparsable snapshot have last-good output to fall back on, which is
      // the state the bogus completions came from.
      await waitForDiagnostics(uri, () => true);
      let typed = "";
      for (const ch of text) {
        const at = { line: start.line, character: start.character + typed.length };
        await server.updateTextDocument(uri, [{ range: { start: at, end: at }, newText: ch }]);
        typed += ch;
        const pos = { line: start.line, character: start.character + typed.length };
        if (ch !== ".") {
          // Quick suggestions fire on ordinary keystrokes too; requesting here
          // reproduces the editor's rhythm, which is what keeps a mid-word
          // state like `const x = as` (parseable) as the last-good fallback
          // the marker states then map through.
          await server.sendCompletionRequest(uri, pos);
          continue;
        }
        expect(await completionOnDotTrigger(uri, pos), `after typing ${JSON.stringify(typed)}`).toEqual([]);
      }
    });
  }

  // The state the screenshot came from: `person.` with NO name token after the
  // dot — before `;` (`return person.;`) or before the closing brace. The test
  // below survives only because `return` on the next line parses as the
  // property name; here Babel used to bail the whole file, the editor served
  // stale output, and the `.`-triggered completion listed the global scope
  // (`__frame`, `__nola`, `AbortController`, …). The parser now recovers the
  // dangling access verbatim, so TypeScript itself answers with Person.
  for (const [what, line] of [
    ["before `;`", "  return person.;"],
    ["before `}`", "  person."],
  ] as const) {
    it(`a \`.\`-triggered completion on a dangling \`person.\` ${what} offers the Person fields`, async () => {
      const content = [
        'import type { Person } from "./models.js";',
        "export infer function f(t: string) {",
        "  const person = ask ..`x`<Person>;",
        line,
        "}",
        "",
      ].join("\n");
      const uri = pathToFileURL(join(FIXTURE, "src", `dangling-${line.length}.tsi`)).href;
      await server.openInMemoryDocument(uri, "nola", content);
      const labels = await completionOnDotTrigger(uri, positionOf(content, "person.", "person.".length));
      expect(labels).toContain("name");
      expect(labels).toContain("home");
      expect(labels).not.toContain("__frame");
      expect(labels).not.toContain("AbortController");
    });
  }

  it("completion after `person.` offers the Person fields", async () => {
    const content = [
      'import type { Person } from "./models.js";',
      "export infer function f(t: string) {",
      "  const person = ask ..`x`<Person>;",
      "  person.",
      "  return person;",
      "}",
      "",
    ].join("\n");
    const uri = pathToFileURL(join(FIXTURE, "src", "complete.tsi")).href;
    await server.openInMemoryDocument(uri, "nola", content);
    const pos = positionOf(content, "  person.", "  person.".length);
    const completions = await server.sendCompletionRequest(uri, pos);
    const labels = completions?.items.map((i) => i.label) ?? [];
    expect(labels).toContain("name");
    expect(labels).toContain("home");
  });
});
