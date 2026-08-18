// Track 3 acceptance (spec §7a, protocol-level): diagnostics (TS-mapped +
// nola-native), hover, completion, go-to-definition against the REAL
// examples/cross-file-types project — same resolution the dogfood editor uses.
//
// The server uses PUSH diagnostics (volar-service-typescript declares
// interFileDependencies, which disables Volar's pull-diagnostics mode), so
// tests collect textDocument/publishDiagnostics notifications.
import { readFileSync } from "node:fs";
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
  await server.initialize(pathToFileURL(FIXTURE).href, { typescript: { tsdk: TSDK } });
}, 400_000);

afterAll(async () => {
  await server?.shutdown();
  server?.process.kill();
});

describe("LSP over examples/cross-file-types", () => {
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
    const diags = await waitForDiagnostics(uri, (d) => d.length > 0);
    console.log("DIAGS", JSON.stringify(diags));

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
    expect(labels).toContain("withProvider");
    expect(labels).toContain("withParams");
    // internals and root-only knobs must not leak into the narrow tier
    for (const internal of ["__nolaBrand", "then", "run", "spec", "reviveValue", "withTimeout", "detached"]) {
      expect(labels).not.toContain(internal);
    }
    // the phantom type anchor must not surface as a bracket completion either
    expect(labels.filter((l) => l.includes("IntentOutput"))).toEqual([]);
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
