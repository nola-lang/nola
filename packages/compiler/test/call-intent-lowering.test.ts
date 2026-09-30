// biome-ignore-all lint/suspicious/noTemplateCurlyInString: .tsi fixtures contain literal ${} interpolation
import { compileNola } from "@nola-lang/compiler";
import { describe, expect, it } from "vitest";
import { defHash } from "../src/lower/templates.js";

describe("call intent lowering", () => {
  it("lowers a call intent with a typed extractor slot and a literal", () => {
    const src =
      "declare function fetchUser(name: string, n: number): string;\nconst i = fetchUser``(..`user name`<string>, 42);\n";
    const { code, diagnostics } = compileNola(src, "x.tsi");
    expect(diagnostics).toEqual([]);
    expect(code).toContain(
      "__nola.intents.FunctionCallIntent<Awaited<ReturnType<typeof fetchUser>>>({ fn: fetchUser",
    );
    expect(code).toContain('name: "fetchUser", instruction: ""');
    expect(code).toContain("args: [__nola.intents.ExtractIntent<string>({ instruction: `user name`");
    expect(code).toContain(", 42] })");
  });

  it("keeps marker text as instruction", () => {
    const src =
      "declare function f(a: string): void;\nconst i = f`billing address not shipping`(..`address`<string>);\n";
    const { code, diagnostics } = compileNola(src, "x.tsi");
    expect(diagnostics).toEqual([]);
    expect(code).toContain('instruction: "billing address not shipping"');
  });

  it("member-expression callee gets a typeof type arg with source text as name", () => {
    const src = "declare const api: { fetch(a: string): number };\nconst i = api.fetch``(..`q`<string>);\n";
    const { code, diagnostics } = compileNola(src, "x.tsi");
    expect(diagnostics).toEqual([]);
    expect(code).toContain("FunctionCallIntent<Awaited<ReturnType<typeof api.fetch>>>({ fn: api.fetch");
    expect(code).toContain('name: "api.fetch"');
  });

  it("zero-arg call intent lowers with an empty args array", () => {
    const src = "declare function ping(): void;\nconst i = ping``();\n";
    const { code, diagnostics } = compileNola(src, "x.tsi");
    expect(diagnostics).toEqual([]);
    expect(code).toContain("args: [] })");
  });

  it("NOLA2004: untyped extractor as a direct slot", () => {
    const src = "declare function f(a: string): void;\nconst i = f``(..`name`);\n";
    const { diagnostics } = compileNola(src, "x.tsi");
    expect(diagnostics.map((d) => d.code)).toContain("NOLA2004");
  });

  it("NOLA2004: untyped extractor nested in an object literal slot", () => {
    const src = "declare function f(o: { n: string }): void;\nconst i = f``({ n: ..`name` });\n";
    const { diagnostics } = compileNola(src, "x.tsi");
    expect(diagnostics.map((d) => d.code)).toContain("NOLA2004");
  });

  it("typed extractor nested in an object literal is fine", () => {
    const src =
      "declare function f(o: { n: string; k: number }): void;\nconst i = f``({ n: ..`name`<string>, k: 1 });\n";
    const { diagnostics } = compileNola(src, "x.tsi");
    expect(diagnostics).toEqual([]);
  });

  it("${} in a call hint is legal: lexical holes lower to a fmt template literal", () => {
    const src = "declare function f(a: string): void;\nconst x = 1;\nconst i = f`use ${x}`(..`a`<string>);\n";
    const { code, diagnostics } = compileNola(src, "x.tsi");
    expect(diagnostics).toEqual([]);
    expect(code).toContain(
      `name: "f", instruction: \`use \${__nola.fmt(x)}\`, loc: "3:11", def: "${defHash("x.tsi", "call", "f", "use ${x}")}", args: [`,
    );
  });

  it("`${.member}` in a hint no longer parses: the ordinary syntax error", () => {
    const src = "infer function go() {\n  const v = ask fn`${.default}\nCall once.`(..`arg`<string>);\n  return v;\n}\n";
    expect(compileNola(src, "x.tsi").diagnostics.map((d) => d.code)).toEqual(["NOLA1001"]);
  });

  it("NOLA2010: a Nola construct inside a call-hint hole", () => {
    const src = "infer function go() {\n  const v = ask fn`${..`x`} once`(..`arg`<string>);\n  return v;\n}\n";
    const { diagnostics } = compileNola(src, "x.tsi");
    expect(diagnostics.map((d) => d.code)).toContain("NOLA2010");
  });

  it("a tagged template NOT followed by a call stays plain TS", () => {
    const src = "declare function tag(s: TemplateStringsArray): string;\nconst t = tag`hello`;\n";
    const { code, diagnostics } = compileNola(src, "x.tsi");
    expect(diagnostics).toEqual([]);
    expect(code).toContain("const t = tag`hello`;");
    expect(code).not.toContain("FunctionCallIntent");
  });
});

// A call hint is re-emitted from its source bytes into the args head (the
// copy), so nothing inside its holes can be edited: a construct there is only
// diagnosed. An edit used to throw out of magic-string ("Cannot split a chunk
// that has already been edited") in strict AND tolerant mode — a tolerant throw
// leaves the editor serving stale output.
describe("a Nola construct inside a call hint's hole: a diagnostic, never an edit", () => {
  const decls =
    "declare function f(a: string): string;\ndeclare function g(x: string): string;\ndeclare const items: string[];\n";
  const inBody = (stmt: string, ret = "return v;") => `${decls}infer function go() {\n  ${stmt}\n  ${ret}\n}\n`;
  const cases = [
    {
      name: "a `.x` binding in a callback keeps its NOLA1010 (outside any scope body)",
      src: inBody("const v = ask f`use ${items.map((i) => { const .x = i; return i; })}`(..`a`<string>);"),
      code: "NOLA1010",
      at: "x",
      copy: "`use ${__nola.fmt(items.map((i) => { const .x = i; return i; }))}`",
    },
    {
      name: "a sigil-less call intent is NOLA2010 at the call",
      src: inBody("const v = ask f`use ${g(..`x`<string>)}`(..`a`<string>);"),
      code: "NOLA2010",
      at: "g(..`x`<string>)",
      copy: "`use ${__nola.fmt(g(..`x`<string>))}`",
    },
    {
      name: "a sigil-less call intent nested inside the hole's expression",
      src: inBody("const v = ask f`use ${[g(..`x`<string>)].join()}`(..`a`<string>);"),
      code: "NOLA2010",
      at: "g(..`x`<string>)",
      copy: "`use ${__nola.fmt([g(..`x`<string>)].join())}`",
    },
    {
      name: "a sigil-less call intent in the hint of a context statement's value",
      src: inBody("`note` (f`use ${g(..`x`<string>)}`(..`a`<string>))", "return ask `y`<string>;"),
      code: "NOLA2010",
      at: "g(..`x`<string>)",
      copy: "`use ${__nola.fmt(g(..`x`<string>))}`",
    },
    {
      name: "a sigil-less call intent in a module-body ask's hint",
      src: `${decls}const v = ask f\`use \${g(..\`x\`<string>)}\`(..\`a\`<string>);\n`,
      code: "NOLA2010",
      at: "g(..`x`<string>)",
      copy: "`use ${__nola.fmt(g(..`x`<string>))}`",
    },
  ];

  for (const c of cases) {
    it(c.name, () => {
      for (const tolerant of [false, true]) {
        const r = compileNola(c.src, "x.tsi", { tolerant });
        const mode = tolerant ? "tolerant" : "strict";
        expect(r.diagnostics.map((d) => [d.code, c.src.slice(d.start, d.end)]), mode).toEqual([[c.code, c.at]]);
        // the hint stays the inert copy of its bytes; the call's own slot lowers
        expect(r.code, mode).toContain(`instruction: ${c.copy}, loc:`);
        expect(r.code, mode).toContain("args: [__nola.intents.ExtractIntent<string>({ instruction: `a`");
      }
    });
  }

  it("tolerant mode: a reserved `var .x` / pattern binding in a callback keeps its parse error and nothing else", () => {
    for (const [stmt, code] of [
      ["var .x = i;", "NOLA1014"],
      ["const .{ length } = i;", "NOLA1011"],
    ] as const) {
      const hole = `items.map((i) => { ${stmt} return i; })`;
      const src = inBody(`const v = ask f\`use \${${hole}}\`(..\`a\`<string>);`);
      const r = compileNola(src, "x.tsi", { tolerant: true });
      expect(r.diagnostics.map((d) => [d.code, src.slice(d.start, d.end)]), stmt).toEqual([[code, "."]]);
      expect(r.code, stmt).toContain(`instruction: \`use \${__nola.fmt(${hole})}\`, loc:`);
    }
  });
});

describe("sigil-less call intents (extractor args imply FunctionCallIntent)", () => {
  it("a direct extractor argument makes a plain call a call intent", () => {
    const src =
      "declare function fetchUser(name: string, n: number): string;\nconst i = fetchUser(..`user name`<string>, 42);\n";
    const { code, diagnostics } = compileNola(src, "x.tsi");
    expect(diagnostics).toEqual([]);
    expect(code).toContain(
      "__nola.intents.FunctionCallIntent<Awaited<ReturnType<typeof fetchUser>>>({ fn: fetchUser",
    );
    expect(code).toContain('name: "fetchUser", instruction: ""');
    expect(code).toContain("args: [__nola.intents.ExtractIntent<string>({ instruction: `user name`");
    expect(code).toContain(", 42] })");
  });

  it("an extractor nested in an object literal triggers detection", () => {
    const src =
      "declare function f(o: { n: string; k: number }): void;\nconst i = f({ n: ..`name`<string>, k: 1 });\n";
    const { code, diagnostics } = compileNola(src, "x.tsi");
    expect(diagnostics).toEqual([]);
    expect(code).toContain("FunctionCallIntent<Awaited<ReturnType<typeof f>>>({ fn: f");
  });

  it("an extractor nested in an array literal triggers detection", () => {
    const src = "declare function f(a: string[]): void;\nconst i = f([..`a`<string>]);\n";
    const { code, diagnostics } = compileNola(src, "x.tsi");
    expect(diagnostics).toEqual([]);
    expect(code).toContain("FunctionCallIntent");
  });

  it("member-expression callee triggers with source text as name", () => {
    const src = "declare const api: { fetch(a: string): number };\nconst i = api.fetch(..`q`<string>);\n";
    const { code, diagnostics } = compileNola(src, "x.tsi");
    expect(diagnostics).toEqual([]);
    expect(code).toContain("FunctionCallIntent<Awaited<ReturnType<typeof api.fetch>>>({ fn: api.fetch");
    expect(code).toContain('name: "api.fetch"');
  });

  it("computed member callee triggers", () => {
    const src = 'declare const handlers: { get(a: string): number };\nconst i = handlers["get"](..`q`<string>);\n';
    const { code, diagnostics } = compileNola(src, "x.tsi");
    expect(diagnostics).toEqual([]);
    expect(code).toContain(
      'FunctionCallIntent<Awaited<ReturnType<typeof handlers["get"]>>>({ fn: handlers["get"]',
    );
  });

  it("extractor in a ternary argument does NOT trigger — stays a plain call", () => {
    const src =
      "declare function f(a: unknown): void;\ndeclare const c: boolean;\nconst i = f(c ? ..`a`<string> : ..`b`<string>);\n";
    const { code, diagnostics } = compileNola(src, "x.tsi");
    expect(diagnostics).toEqual([]);
    expect(code).not.toContain("FunctionCallIntent");
    expect(code).toContain("__nola.intents.ExtractIntent<string>");
  });

  it("extractor under a spread element does NOT trigger", () => {
    const src = "declare function f(...a: unknown[]): void;\nconst i = f(...[..`a`<string>]);\n";
    const { code, diagnostics } = compileNola(src, "x.tsi");
    expect(diagnostics).toEqual([]);
    expect(code).not.toContain("FunctionCallIntent");
  });

  it("a nested call claims the extractor — the outer call stays plain", () => {
    const src =
      "declare function inner(a: string): number;\ndeclare function outer(n: unknown): void;\nconst i = outer(inner(..`x`<string>));\n";
    const { code, diagnostics } = compileNola(src, "x.tsi");
    expect(diagnostics).toEqual([]);
    expect(code).toContain("({ fn: inner");
    expect(code).not.toContain("({ fn: outer");
  });

  it("optional calls never trigger", () => {
    const src = "declare const f: undefined | ((a: unknown) => void);\nconst i = f?.(..`a`<string>);\n";
    const { code, diagnostics } = compileNola(src, "x.tsi");
    expect(diagnostics).toEqual([]);
    expect(code).not.toContain("FunctionCallIntent");
  });

  it("`new` never triggers", () => {
    const src = "declare class Foo { constructor(a: unknown); }\nconst i = new Foo(..`a`<string>);\n";
    const { code, diagnostics } = compileNola(src, "x.tsi");
    expect(diagnostics).toEqual([]);
    expect(code).not.toContain("FunctionCallIntent");
  });

  it("exotic callees (call result) never trigger", () => {
    const src = "declare function getFn(): (a: unknown) => void;\nconst i = getFn()(..`a`<string>);\n";
    const { code, diagnostics } = compileNola(src, "x.tsi");
    expect(diagnostics).toEqual([]);
    expect(code).not.toContain("FunctionCallIntent");
  });

  it("NOLA2004: untyped extractor slot in the sigil-less form", () => {
    const src = "declare function f(a: string): void;\nconst i = f(..`name`);\n";
    const { code, diagnostics } = compileNola(src, "x.tsi");
    expect(diagnostics.map((d) => d.code)).toContain("NOLA2004");
    // detection still fired — the untyped slot is an error INSIDE a call intent
    expect(code).toContain("FunctionCallIntent");
  });

  it("sigil and sigil-less spellings lower identically (modulo loc columns)", () => {
    const sigil =
      "declare function f(a: string, o: { n: string }): void;\nconst i = f``(..`a`<string>, { n: ..`n`<string> });\n";
    const bare = sigil.replace("f``(", "f(");
    const norm = (code: string) => code.replace(/loc: "\d+:\d+"/g, 'loc: "_"');
    const a = compileNola(sigil, "x.tsi");
    const b = compileNola(bare, "x.tsi");
    expect(a.diagnostics).toEqual([]);
    expect(b.diagnostics).toEqual([]);
    expect(norm(b.code)).toBe(norm(a.code));
  });
});

// Implied sigil in call slots (spec 2026-09-30): a typed template that starts
// an argument — or a value nested in plain object/array literals there — is an
// extractor without the dots. The parser yields the same node shape, so the
// lowering is the `..` form's byte for byte apart from `loc`, which now names
// the backtick.
describe("implied extractor sigil in call slots", () => {
  const norm = (code: string) => code.replace(/loc: "\d+:\d+"/g, 'loc: "_"');

  it("a direct slot, both type spellings, lowers as the `..` form does", () => {
    const dotted = "declare function f(a: string, n: number): void;\nconst i = f(..`a`<string>, 2);\n";
    const a = compileNola(dotted, "x.tsi");
    expect(a.diagnostics).toEqual([]);
    for (const src of [dotted.replace("..`a`<string>", "`a`<string>"), dotted.replace("..`a`<string>", "`a`: string")]) {
      const b = compileNola(src, "x.tsi");
      expect(b.diagnostics).toEqual([]);
      expect(norm(b.code)).toBe(norm(a.code));
      expect(b.code).toContain("FunctionCallIntent<Awaited<ReturnType<typeof f>>>({ fn: f");
    }
  });

  it("the extractor's loc is the backtick, and its def is the `..` form's", () => {
    const { code } = compileNola("declare function f(a: string): void;\nconst i = f(`the title`: string);\n", "x.tsi");
    expect(code).toContain(`loc: "2:13", def: "${defHash("x.tsi", "extract", "the title", "string")}"`);
  });

  it("nested in an object literal and in an array literal, under `ask` in an infer body", () => {
    const dotted = [
      "declare const api: { save(o: { qty: number; note: string }, tags: string[]): Promise<string> };",
      "infer function go() {",
      "  return ask api.save({ qty: 1, note: ..`a note`: string }, [..`a tag`: string]);",
      "}",
      "",
    ].join("\n");
    const a = compileNola(dotted, "x.tsi");
    const b = compileNola(dotted.replaceAll("..`", "`"), "x.tsi");
    expect(a.diagnostics).toEqual([]);
    expect(b.diagnostics).toEqual([]);
    expect(norm(b.code)).toBe(norm(a.code));
  });

  it("an untyped template argument is a string: the call stays plain and raises nothing", () => {
    const { code, diagnostics } = compileNola("declare function f(a: string): void;\nconst r = f(`hello`);\n", "x.tsi");
    expect(diagnostics).toEqual([]);
    expect(code).toContain("const r = f(`hello`);");
    expect(code).not.toContain("FunctionCallIntent");
  });

  it("NOLA2004 on a slot whose colon type is missing (tolerant), like the `..` form", () => {
    const codesOf = (src: string) =>
      compileNola(src, "x.tsi", { tolerant: true })
        .diagnostics.map((d) => d.code)
        .sort();
    const implied = codesOf("declare function f(a: string): void;\nconst i = f(`a`: );\n");
    expect(implied).toEqual(codesOf("declare function f(a: string): void;\nconst i = f(..`a`: );\n"));
    expect(implied).toEqual(["NOLA1018", "NOLA2004"]);
  });
});
