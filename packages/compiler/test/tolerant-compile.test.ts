import { compileNola } from "@nola-lang/compiler";
import { describe, expect, it } from "vitest";
import { typecheckLowered } from "./helpers/typecheck.js";

// One broken extractor (`..5` — NOLA1005) inside an otherwise valid infer
// function that also contains a good extractor.
const SRC = [
  "infer function go(input: string) {",
  "  const broken = ..5;",
  // biome-ignore lint/suspicious/noTemplateCurlyInString: literal ${...} in .tsi fixture source
  "  return ask ..`extract ${input}`<string>;",
  "}",
  "",
].join("\n");

describe("compileNola tolerant mode", () => {
  it("lowers intact constructs and passes parse diagnostics through", () => {
    const r = compileNola(SRC, "t.tsi", { tolerant: true });
    expect(r.diagnostics.map((d) => d.code)).toContain("NOLA1005");
    // the infer function and the good extractor lowered normally
    expect(r.code).toContain("__nola.intents.Intent(");
    expect(r.code).toContain("__nola.intents.ExtractIntent<string>");
    expect(r.code).toContain("await __nola.ask(");
    // the broken construct becomes an inert placeholder — its original bytes
    // would put a dot in the generated text where the editor maps the cursor
    expect(r.code).toContain("const broken = (undefined as never)5;");
    expect(r.meta.nolaFunctions).toEqual(["go"]);
  });

  it("strict mode still bails to source on the same input", () => {
    const r = compileNola(SRC, "t.tsi");
    expect(r.code).toBe(SRC);
    expect(r.diagnostics).toHaveLength(1);
    expect(r.diagnostics[0]?.code).toBe("NOLA1005");
  });

  // A half-typed `..` marker is the most common tolerant-mode state there is —
  // it exists on every keystroke between `ask ` and `` ask ..`p` ``. Leaving its
  // bytes in place put a dot in the generated text right where the cursor maps,
  // and TypeScript answers a `.`-triggered completion there with the whole
  // global scope. An inert replacement keeps the generated text valid and
  // dot-free, so the editor stays quiet until the prompt is actually typed.
  // (Not an emit-contract change: broken constructs never reach a build — strict
  // mode throws on them — so nothing executes this text.)
  describe("half-typed `..` markers", () => {
    const midTyping = (marker: string) => `infer function go() {\n  const x = ask ${marker}\n  return x;\n}\n`;

    for (const marker of [".", ".."]) {
      it(`\`ask ${marker}\` lowers to an inert expression, not raw dots`, () => {
        const r = compileNola(midTyping(marker), "t.tsi", { tolerant: true });
        expect(r.meta.mode).toBe("lowered");
        expect(r.diagnostics.map((d) => d.code)).toContain("NOLA1005");
        expect(r.code).toContain("__nola.ask((undefined as never), __frame)");
        expect(typecheckLowered({ "t.ts": r.code })).toEqual([]);
      });
    }
  });

  // The third marker site: a `.` context parameter being typed between the
  // parens. Same requirement as the `ask` marker — the dot must not survive
  // into the generated TS, and the span must be `broken` so the editor opts
  // the character after it (where the cursor sits) out of completion. The
  // retired `..` spelling recovers the same way.
  describe("nameless `.` context parameters", () => {
    const midTyping = (params: string) => `infer function go(${params}) {\n  return 1;\n}\n`;

    for (const params of [".", "a: string, .", "..", "a: string, .."]) {
      it(`\`(${params})\` lowers to a parameter list without dots`, () => {
        const r = compileNola(midTyping(params), "t.tsi", { tolerant: true });
        expect(r.meta.mode).toBe("lowered");
        expect(r.diagnostics.map((d) => d.code)).toContain("NOLA1012");
        expect(r.code.split("\n")[0]).toBe(`function go(${params.replace(/\.+$/, "")}) {`);
        expect(typecheckLowered({ "t.ts": r.code })).toEqual([]);
        // the marker's own span, so the editor can silence the cursor after it
        const broken = r.meta.spans.filter((s) => s.kind === "broken");
        expect(broken).toHaveLength(1);
        expect(midTyping(params).slice(broken[0]?.sourceStart, broken[0]?.sourceEnd)).toBe(params.replace(/^.*, /, ""));
      });
    }

    it("the retired `..name` spelling still lowers as a contextual param (NOLA1013)", () => {
      const r = compileNola("infer function go(..t: string) {\n  return 1;\n}\n", "t.tsi", { tolerant: true });
      expect(r.diagnostics.map((d) => d.code)).toEqual(["NOLA1013"]);
      expect(r.code.split("\n")[0]).toBe("function go(t: string) {");
      expect(r.code).toBe(compileNola("infer function go(.t: string) {\n  return 1;\n}\n", "t.tsi").code);
      expect(typecheckLowered({ "t.ts": r.code })).toEqual([]);
    });
  });

  // Reserved contextual bindings: strict mode never reaches the lowerer
  // (raise throws), tolerant mode must not leave the dot in generated TS.
  describe("reserved `var .x` bindings", () => {
    it("lower to a plain declaration under a `broken` span", () => {
      const src = "infer function go(.t: string) {\n  var .bio = ask ..`bio`<string>;\n  return bio;\n}\n";
      const r = compileNola(src, "t.tsi", { tolerant: true });
      expect(r.meta.mode).toBe("lowered");
      expect(r.diagnostics.map((d) => d.code)).toEqual(["NOLA1014"]);
      expect(r.code).toContain("var bio = ");
      expect(r.code).not.toContain(".bio");
      expect(typecheckLowered({ "t.ts": r.code })).toEqual([]);
      const broken = r.meta.spans.filter((s) => s.kind === "broken");
      expect(broken).toHaveLength(1);
      expect(src.slice(broken[0]?.sourceStart, broken[0]?.sourceEnd)).toBe(".");
    });
  });

  it("tolerant mode on a valid file matches strict output byte-for-byte", () => {
    const ok = "infer function go() {\n  return ask ..`hi`;\n}\n";
    expect(compileNola(ok, "t.tsi", { tolerant: true }).code).toBe(compileNola(ok, "t.tsi").code);
  });

  // Sigil-less call intents: detection counts only WELL-FORMED extractors, so
  // the half-typed states a user passes through while typing `f(..`x`<T>)` keep
  // the call plain — no call intent is ever lowered around a broken slot, and
  // no NOLA2004 fires mid-keystroke.
  describe("sigil-less call intents in tolerant mode", () => {
    it("a bare `f(..)` placeholder does NOT trigger detection — plain call, inert arg", () => {
      const src = "declare function f(a: unknown): void;\nconst i = f(..);\n";
      const r = compileNola(src, "t.tsi", { tolerant: true });
      expect(r.meta.mode).toBe("lowered");
      expect(r.diagnostics.map((d) => d.code)).toContain("NOLA1004");
      expect(r.code).toContain("f((undefined as never))");
      expect(r.code).not.toContain("FunctionCallIntent");
      expect(typecheckLowered({ "t.ts": r.code })).toEqual([]);
    });

    it("completing the extractor flips the same call into a call intent", () => {
      const src = "declare function f(a: string): void;\nconst i = f(..`a`<string>);\n";
      const r = compileNola(src, "t.tsi", { tolerant: true });
      expect(r.diagnostics).toEqual([]);
      expect(r.code).toContain("FunctionCallIntent");
    });
  });

  it("a half-typed `${.` in an extractor lowers with the scope prefix so TS can complete after the dot", () => {
    // biome-ignore lint/suspicious/noTemplateCurlyInString: literal ${...} in .tsi fixture source
    const src = "infer function go() {\n  const v = ask ..`x ${.}`;\n  return v;\n}\n";
    const { code, diagnostics, meta } = compileNola(src, "x.tsi", { tolerant: true });
    expect(diagnostics.map((d) => d.code)).toEqual(["NOLA1015"]);
    expect(meta.mode).not.toBe("bailed");
    // biome-ignore lint/suspicious/noTemplateCurlyInString: literal ${...} in lowered output
    expect(code).toContain("__nola.tpl`x ${__nola_s.}`");
  });
});

// `person.` mid-typing: no Nola construct is involved, but the parser used to
// bail on it and the editor fell back to stale output. Recovery keeps the
// bytes verbatim so TypeScript itself parses the dangling access, completes
// the Person members after the dot and reports its own "Identifier expected".
describe("dangling member access in tolerant mode", () => {
  it("lowers the rest of the file and leaves `person.` verbatim", () => {
    const src = [
      "interface Person { name: string; age: number }",
      "infer function go(.message: string) {",
      "  const person = ask ..`the person`<Person>;",
      "  return person.;",
      "}",
      "",
    ].join("\n");
    const r = compileNola(src, "t.tsi", { tolerant: true });
    expect(r.meta.mode).toBe("lowered");
    expect(r.diagnostics).toEqual([]);
    expect(r.code).toContain("  return person.;");
    expect(r.code).toContain("__nola.intents.ExtractIntent<Person>");
    const tsDiags = typecheckLowered({ "t.ts": r.code });
    expect(tsDiags).toHaveLength(1);
    expect(tsDiags[0]).toMatch(/Identifier expected/);
  });

  // `console.` as the LAST thing in the file: the appendix begins right after
  // it, and TypeScript reads `console.` + newline + `import { __nola } ...` as
  // the property access `console.import` — its keyword-on-the-next-line
  // recovery fires only when the keyword is followed by an identifier on the
  // same line, and `{` is not one. The runtime import vanished and every
  // `__nola` in the file became TS2304 at the ask sites.
  it("a dangling access at the end of the file does not swallow the appendix import", () => {
    const src = ["const person = ask `the person`<{ name: string }>;", "console."].join("\n");
    const r = compileNola(src, "t.tsi", { tolerant: true });
    expect(r.meta.mode).toBe("lowered");
    expect(r.diagnostics).toEqual([]);
    const tsDiags = typecheckLowered({ "t.ts": r.code });
    expect(tsDiags.filter((d) => /__nola/.test(d))).toEqual([]);
    expect(tsDiags).toHaveLength(1);
    expect(tsDiags[0]).toMatch(/Identifier expected/);
  });
});

// `ask `p`;<T>` — the `;` slipped in before the type args. Babel's TS mixin
// reads `<T>` as a type assertion whose operand is missing at EOF; the parser
// recovers it into the placeholder (see the parser's tolerant tests), which
// here must lower to the inert expression under a ZERO-LENGTH broken span —
// there are no source bytes to overwrite. Bailing instead served stale
// last-good mappings against the edited text: semantic tokens painted the
// wrong characters and the parse error was dropped.
describe("expression expected at end of file", () => {
  it("lowers the missing operand of a trailing `<T>` to the inert placeholder", () => {
    const src = "type T = { a: string }\nconst r = ask `p`;<T>\n\n";
    const r = compileNola(src, "t.tsi", { tolerant: true });
    expect(r.meta.mode).toBe("lowered");
    expect(r.diagnostics.map((d) => d.code)).toEqual(["NOLA1001"]);
    expect(r.code).toContain(";<T>(undefined as never)\n\n");
    expect(typecheckLowered({ "t.ts": r.code })).toEqual([]);
    const broken = r.meta.spans.filter((s) => s.kind === "broken");
    expect(broken).toHaveLength(1);
    expect(broken[0]).toMatchObject({ sourceStart: src.indexOf("<T>") + 3, sourceEnd: src.indexOf("<T>") + 3 });
  });

  it("lowers the missing operand of `<T>;` mid-file the same way, and the rest of the file lowers normally", () => {
    const src = "type T = { a: string }\nconst r = ask `p`;<T>;\nconst q = ask `q`<T>;\n";
    const r = compileNola(src, "t.tsi", { tolerant: true });
    expect(r.meta.mode).toBe("lowered");
    expect(r.diagnostics.map((d) => d.code)).toEqual(["NOLA1001"]);
    expect(r.code).toContain(";<T>(undefined as never);\n");
    // the ask after the broken line is still lowered, with ITS type args intact
    expect(r.code).toContain("__nola.ask(__nola.intents.ExtractIntent<T>({ instruction: `q`");
    expect(typecheckLowered({ "t.ts": r.code })).toEqual([]);
    const broken = r.meta.spans.filter((s) => s.kind === "broken");
    expect(broken).toHaveLength(1);
    expect(broken[0]).toMatchObject({ sourceStart: src.indexOf("<T>;") + 3, sourceEnd: src.indexOf("<T>;") + 3 });
  });

  it("strict mode bails to source", () => {
    const r = compileNola("const r = ask `p`;<T>\n", "t.tsi");
    expect(r.meta.mode).toBe("bailed");
  });
});
