// biome-ignore-all lint/suspicious/noTemplateCurlyInString: .tsi fixtures contain literal ${} interpolation
import { compileNola } from "@nola-lang/compiler";
import { describe, expect, it } from "vitest";

describe("call intent lowering", () => {
  it("lowers a call intent with a typed extractor slot and a literal", () => {
    const src =
      "declare function fetchUser(name: string, n: number): string;\nconst i = fetchUser``(..`user name`<string>, 42);\n";
    const { code, diagnostics } = compileNola(src, "x.tsi");
    expect(diagnostics).toEqual([]);
    expect(code).toContain(
      "__nola.intents.FunctionCallingIntent<Awaited<ReturnType<typeof fetchUser>>>({ fn: fetchUser",
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
    expect(code).toContain("FunctionCallingIntent<Awaited<ReturnType<typeof api.fetch>>>({ fn: api.fetch");
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

  it("${} in a call hint is legal (NOLA2005 retired): lexical holes lower to a fmt template literal", () => {
    const src = "declare function f(a: string): void;\nconst x = 1;\nconst i = f`use ${x}`(..`a`<string>);\n";
    const { code, diagnostics } = compileNola(src, "x.tsi");
    expect(diagnostics).toEqual([]);
    expect(code).toContain('name: "f", instruction: `use ${__nola.fmt(x)}`, loc: "3:11", args: [');
  });

  it("a scope-hole hint lowers to instruction string + template closure (copied into the args head, anchored)", () => {
    const src = "infer function go() {\n  const v = ask fn`${.default}\nCall once.`(..`arg`<string>);\n  return v;\n}\n";
    const { code, diagnostics, meta } = compileNola(src, "x.tsi");
    expect(diagnostics).toEqual([]);
    expect(code).toContain(
      'name: "fn", instruction: "${.default}\\nCall once.", template: (__nola_s) => __nola.tpl`${__nola_s.default}\nCall once.`, loc: "2:17", args: [',
    );
    const anchored = meta.anchors.map((a) => src.slice(a.sourceStart, a.sourceEnd));
    expect(anchored).toContain(".default}\nCall once.`");
    for (const a of meta.anchors) {
      expect(code.slice(a.generatedStart, a.generatedEnd)).toBe(src.slice(a.sourceStart, a.sourceEnd));
    }
  });

  it("NOLA2010: a Nola construct inside a call-hint hole", () => {
    const src = "infer function go() {\n  const v = ask fn`${..`x`} ${.default}`(..`arg`<string>);\n  return v;\n}\n";
    const { diagnostics } = compileNola(src, "x.tsi");
    expect(diagnostics.map((d) => d.code)).toContain("NOLA2010");
  });

  it("a tagged template NOT followed by a call stays plain TS", () => {
    const src = "declare function tag(s: TemplateStringsArray): string;\nconst t = tag`hello`;\n";
    const { code, diagnostics } = compileNola(src, "x.tsi");
    expect(diagnostics).toEqual([]);
    expect(code).toContain("const t = tag`hello`;");
    expect(code).not.toContain("FunctionCallingIntent");
  });
});

describe("sigil-less call intents (extractor args imply FunctionCallingIntent)", () => {
  it("a direct extractor argument makes a plain call a call intent", () => {
    const src =
      "declare function fetchUser(name: string, n: number): string;\nconst i = fetchUser(..`user name`<string>, 42);\n";
    const { code, diagnostics } = compileNola(src, "x.tsi");
    expect(diagnostics).toEqual([]);
    expect(code).toContain(
      "__nola.intents.FunctionCallingIntent<Awaited<ReturnType<typeof fetchUser>>>({ fn: fetchUser",
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
    expect(code).toContain("FunctionCallingIntent<Awaited<ReturnType<typeof f>>>({ fn: f");
  });

  it("an extractor nested in an array literal triggers detection", () => {
    const src = "declare function f(a: string[]): void;\nconst i = f([..`a`<string>]);\n";
    const { code, diagnostics } = compileNola(src, "x.tsi");
    expect(diagnostics).toEqual([]);
    expect(code).toContain("FunctionCallingIntent");
  });

  it("member-expression callee triggers with source text as name", () => {
    const src = "declare const api: { fetch(a: string): number };\nconst i = api.fetch(..`q`<string>);\n";
    const { code, diagnostics } = compileNola(src, "x.tsi");
    expect(diagnostics).toEqual([]);
    expect(code).toContain("FunctionCallingIntent<Awaited<ReturnType<typeof api.fetch>>>({ fn: api.fetch");
    expect(code).toContain('name: "api.fetch"');
  });

  it("computed member callee triggers", () => {
    const src = 'declare const handlers: { get(a: string): number };\nconst i = handlers["get"](..`q`<string>);\n';
    const { code, diagnostics } = compileNola(src, "x.tsi");
    expect(diagnostics).toEqual([]);
    expect(code).toContain(
      'FunctionCallingIntent<Awaited<ReturnType<typeof handlers["get"]>>>({ fn: handlers["get"]',
    );
  });

  it("extractor in a ternary argument does NOT trigger — stays a plain call", () => {
    const src =
      "declare function f(a: unknown): void;\ndeclare const c: boolean;\nconst i = f(c ? ..`a`<string> : ..`b`<string>);\n";
    const { code, diagnostics } = compileNola(src, "x.tsi");
    expect(diagnostics).toEqual([]);
    expect(code).not.toContain("FunctionCallingIntent");
    expect(code).toContain("__nola.intents.ExtractIntent<string>");
  });

  it("extractor under a spread element does NOT trigger", () => {
    const src = "declare function f(...a: unknown[]): void;\nconst i = f(...[..`a`<string>]);\n";
    const { code, diagnostics } = compileNola(src, "x.tsi");
    expect(diagnostics).toEqual([]);
    expect(code).not.toContain("FunctionCallingIntent");
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
    expect(code).not.toContain("FunctionCallingIntent");
  });

  it("`new` never triggers", () => {
    const src = "declare class Foo { constructor(a: unknown); }\nconst i = new Foo(..`a`<string>);\n";
    const { code, diagnostics } = compileNola(src, "x.tsi");
    expect(diagnostics).toEqual([]);
    expect(code).not.toContain("FunctionCallingIntent");
  });

  it("exotic callees (call result) never trigger", () => {
    const src = "declare function getFn(): (a: unknown) => void;\nconst i = getFn()(..`a`<string>);\n";
    const { code, diagnostics } = compileNola(src, "x.tsi");
    expect(diagnostics).toEqual([]);
    expect(code).not.toContain("FunctionCallingIntent");
  });

  it("NOLA2004: untyped extractor slot in the sigil-less form", () => {
    const src = "declare function f(a: string): void;\nconst i = f(..`name`);\n";
    const { code, diagnostics } = compileNola(src, "x.tsi");
    expect(diagnostics.map((d) => d.code)).toContain("NOLA2004");
    // detection still fired — the untyped slot is an error INSIDE a call intent
    expect(code).toContain("FunctionCallingIntent");
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
