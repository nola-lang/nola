// biome-ignore-all lint/suspicious/noTemplateCurlyInString: .tsi fixtures and lowered output contain literal ${} interpolation
import { compileNola } from "@nola-lang/compiler";
import { describe, expect, it } from "vitest";
import { defHash } from "../src/lower/templates.js";
import { typecheckLowered } from "./helpers/typecheck.js";

// Every compile checks the debugger's layout invariant (spec §3.7): lowering adds
// or removes no line terminator — an infer wrapper's opener and closer are the
// only new lines, and the appendix follows the source.
const compile = (src: string, opts?: { tolerant?: boolean }) => {
  const r = compileNola(src, "x.tsi", opts);
  const appendix = r.meta.spans.find((s) => s.kind === "appendix");
  const lines = r.code.slice(0, appendix?.generatedStart).split("\n").length - 2 * r.meta.nolaFunctions.length;
  expect(lines, "line layout").toBe(src.split("\n").length);
  return r;
};

/** What `__nola.ctx` receives when a one-line item with no free variables renders: its text parts and its values. */
const renderItem = (code: string, name: string) => {
  const line = code.split("\n").find((l) => l.includes(`function ${name}()`)) ?? "";
  const ctx = (strings: TemplateStringsArray, ...values: unknown[]) => ({ strings: [...strings], values });
  return new Function("__nola", `${line}\nreturn ${name}();`)({ ctx });
};

describe("context statement lowering (spec 2026-09-29 §3.3)", () => {
  it("reproduces the spec §3.3 example byte for byte (§3.1's src/inbox.tsi)", () => {
    const src = [
      "`You triage a support inbox.`",
      "",
      "export infer function triage(.ticket: string) {",
      "  `Answer with the order id only.`",
      "  return ask `order id`<string>;",
      "}",
      "",
      "`Escalations go to the on-call engineer.`",
      "",
      "export infer function escalate(.ticket: string, oncall: string) {",
      "  `Page` oncall `when the ticket is an outage.`",
      "  const steps: string[] = [];",
      "  `Steps taken so far:` steps;",
      "  while (steps.length < 3) {",
      "    const next = ask `the next step`<string>;",
      "    steps.push(next);",
      "  }",
      "  return steps;",
      "}",
      "",
    ].join("\n");
    const { code, diagnostics } = compileNola(src, "/p/src/inbox.tsi", { sourceRoot: "/p" });
    expect(diagnostics).toEqual([]);
    const def = (text: string) => defHash("src/inbox.tsi", "extract", text, "string");
    expect(code.slice(0, code.indexOf("\n;\nimport { __nola }"))).toBe(
      [
        "void __nola_ctx_1; function __nola_ctx_1() { return __nola.ctx`You triage a support inbox.`; }",
        "",
        "export function triage(ticket: string) {",
        "  return __nola.intents.Intent(async (__frame) => { void ticket;",
        "  void __nola_ctx_2; function __nola_ctx_2() { return __nola.ctx`Answer with the order id only.`; }",
        `  return await __nola.ask(__nola.intents.ExtractIntent<string>({ instruction: \`order id\`, type: __nola_type_$2(), loc: "5:14", def: "${def("order id")}" }), __frame, { context: [__nola_ctx_2] });`,
        '  }, __nola_module_ctx().func({ fn: "triage", args: [{ name: "ticket", type: __nola_type_$1(), contextual: true, value: ticket }], moduleContext: [__nola_ctx_1] }));',
        "}",
        "",
        "void __nola_ctx_3; function __nola_ctx_3() { return __nola.ctx`Escalations go to the on-call engineer.`; }",
        "",
        "export function escalate(ticket: string, oncall: string) {",
        "  return __nola.intents.Intent(async (__frame) => { void ticket; void oncall;",
        "  void __nola_ctx_4; function __nola_ctx_4() { return __nola.ctx`Page ${oncall} when the ticket is an outage.`; }",
        "  const steps: string[] = [];",
        "  void __nola_ctx_5; function __nola_ctx_5() { return __nola.ctx`Steps taken so far: ${steps}`; }",
        "  while (steps.length < 3) {",
        `    const next = await __nola.ask(__nola.intents.ExtractIntent<string>({ instruction: \`the next step\`, type: __nola_type_$5(), loc: "15:22", def: "${def("the next step")}" }), __frame, { context: [__nola_ctx_4, __nola_ctx_5] });`,
        "    steps.push(next);",
        "  }",
        "  return steps;",
        '  }, __nola_module_ctx().func({ fn: "escalate", args: [{ name: "ticket", type: __nola_type_$3(), contextual: true, value: ticket }, { name: "oncall", type: __nola_type_$4() }], moduleContext: [__nola_ctx_1, __nola_ctx_3] }));',
        "}",
        "",
      ].join("\n"),
    );
    expect(code).toContain(
      'function __nola_module_ctx() { return __nola.context.module("src/inbox.tsi", 21, () => ({ context: [__nola_ctx_1, __nola_ctx_3] })); }',
    );
    expect(typecheckLowered({ "inbox.ts": code })).toEqual([]);
  });

  describe("in an infer body", () => {
    it("prose: the first statement stays in place as a hoisted function; the ask passes it; the opener sits at `{`", () => {
      const src = ["infer function go(.q: string) {", "  `answer tersely`", "  return ask ..`v`<string>;", "}", ""].join("\n");
      const { code, diagnostics } = compile(src);
      expect(diagnostics).toEqual([]);
      expect(code).toContain(
        "function go(q: string) {\n  return __nola.intents.Intent(async (__frame) => { void q;\n  void __nola_ctx_1; function __nola_ctx_1() { return __nola.ctx`answer tersely`; }\n",
      );
      expect(code).toContain("}), __frame, { context: [__nola_ctx_1] });");
      expect(code).toContain('.func({ fn: "go", args: [{ name: "q", type: __nola_type_$1(), contextual: true, value: q }] }));');
      expect(code).not.toContain("instruction: \"answer");
      expect(typecheckLowered({ "x.ts": code })).toEqual([]);
    });

    it("a value: the boundary backticks become a hole around the verbatim value, whitespace kept as written", () => {
      const src = ["infer function go(.ticket: string, oncall: string) {", "  `Page` oncall `when the ticket is an outage.`;", "  return ask ..`v`<string>;", "}", ""].join("\n");
      const { code, diagnostics, meta } = compile(src);
      expect(diagnostics).toEqual([]);
      expect(code).toContain("  void __nola_ctx_1; function __nola_ctx_1() { return __nola.ctx`Page ${oncall} when the ticket is an outage.`; }\n");
      // the value's bytes are verbatim (full editor features), the rewrites are replaced spans
      const at = src.indexOf("oncall `when");
      expect(meta.spans.some((s) => s.kind === "verbatim" && s.sourceStart <= at && at + "oncall".length <= s.sourceEnd)).toBe(true);
      expect(typecheckLowered({ "x.ts": code })).toEqual([]);
    });

    it("a trailing value gets a synthesized closing backtick; a glued `;` is the closer", () => {
      const src = ["infer function go() {", "  const steps: string[] = [];", "  `Steps taken so far:` steps;", "  return ask ..`v`<string>;", "}", ""].join("\n");
      const { code, diagnostics } = compile(src);
      expect(diagnostics).toEqual([]);
      expect(code).toContain("  void __nola_ctx_1; function __nola_ctx_1() { return __nola.ctx`Steps taken so far: ${steps}`; }\n");
      expect(typecheckLowered({ "x.ts": code })).toEqual([]);
    });

    it("no `;`: the closer is appended after the last part", () => {
      const src = ["infer function go(n: number) {", "  `at most` n `words`", "  return ask ..`v`<string>;", "}", ""].join("\n");
      const { code, diagnostics } = compile(src);
      expect(diagnostics).toEqual([]);
      expect(code).toContain("  void __nola_ctx_1; function __nola_ctx_1() { return __nola.ctx`at most ${n} words`; }\n  return await __nola.ask(");
    });

    it("`${}` holes inside a text part stay as written — the tag formats them, no __nola.fmt insert", () => {
      const src = ["infer function go(n: number) {", "  `at most ${n} words` n `ok`;", "  return ask ..`v`<string>;", "}", ""].join("\n");
      const { code, diagnostics } = compile(src);
      expect(diagnostics).toEqual([]);
      expect(code).toContain("return __nola.ctx`at most ${n} words ${n} ok`; }");
      expect(code).not.toContain("__nola.fmt(n)");
    });

    it("a multi-line statement keeps every line: value on line 1, text on lines 2-3, `;` on its own line stays verbatim", () => {
      const src = [
        "infer function go(user: string) {",
        "  `Analyze` user",
        "  `carefully.`",
        "  `Then report.`",
        "  ;",
        "  return ask ..`v`<string>;",
        "}",
        "",
      ].join("\n");
      const { code, diagnostics } = compile(src);
      expect(diagnostics).toEqual([]);
      const lines = code.split("\n");
      expect(lines[2]).toBe("  void __nola_ctx_1; function __nola_ctx_1() { return __nola.ctx`Analyze ${user}");
      expect(lines[3]).toBe("  carefully.");
      expect(lines[4]).toBe("  Then report.`; }");
      expect(lines[5]).toBe("  ;");
      expect(lines[6]).toMatch(/^ {2}return await __nola\.ask\(/);
      expect(typecheckLowered({ "x.ts": code })).toEqual([]);
    });

    it("glued texts concatenate; only a `$` meeting a `{` gets the empty hole that keeps them apart", () => {
      const src = ["infer function go() {", "  `cost $``{x}`;", "  `a``b`;", "  `cost \\$``{x}`;", "  return ask ..`v`<string>;", "}", ""].join("\n");
      const { code, diagnostics } = compile(src);
      expect(diagnostics).toEqual([]);
      expect(code).toContain('void __nola_ctx_1; function __nola_ctx_1() { return __nola.ctx`cost $${""}{x}`; }');
      expect(code).toContain("void __nola_ctx_2; function __nola_ctx_2() { return __nola.ctx`ab`; }");
      // an escaped `$` opens no hole, so nothing needs keeping apart
      expect(code).toContain("void __nola_ctx_3; function __nola_ctx_3() { return __nola.ctx`cost \\${x}`; }");
      // what the tag receives: the guard's one empty value, and only where the hazard is
      expect(renderItem(code, "__nola_ctx_1")).toEqual({ strings: ["cost $", "{x}"], values: [""] });
      expect(renderItem(code, "__nola_ctx_2")).toEqual({ strings: ["ab"], values: [] });
      expect(renderItem(code, "__nola_ctx_3")).toEqual({ strings: ["cost ${x}"], values: [] });
      expect(typecheckLowered({ "x.ts": code })).toEqual([]);
    });

    it("a parenthesized template is a value: it sits in a hole with its parentheses, never merged into the text", () => {
      const src = ["infer function go(x: string) {", "  `a` (`b`);", "  `a` (`b ${x}`) `c`;", "  return ask ..`v`<string>;", "}", ""].join("\n");
      const { code, diagnostics } = compile(src);
      expect(diagnostics).toEqual([]);
      expect(code).toContain(
        "  void __nola_ctx_1; function __nola_ctx_1() { return __nola.ctx`a ${(`b`)}`; }\n  void __nola_ctx_2; function __nola_ctx_2() { return __nola.ctx`a ${(`b ${x}`)} c`; }\n",
      );
      expect(renderItem(code, "__nola_ctx_1")).toEqual({ strings: ["a ", ""], values: ["b"] });
      expect(typecheckLowered({ "x.ts": code })).toEqual([]);
    });

    it("tight layouts lower to valid TS: an item glued to a brace, and a statement glued after its `;`", () => {
      const glued = "declare function log(a: string): void;\ninfer function go() {\n  `be terse`;ask log(..`x`<string>);\n}\n";
      for (const src of [
        glued,
        "declare function log(a: string): void;\nconst n = 1;\ninfer function go() {\n  `at most ${n} words`;ask log(..`x`<string>);\n}\n",
        "infer function go() {`be terse`}\n",
        "infer function go() {`x`;}\n",
      ]) {
        const { code, diagnostics } = compile(src);
        expect(diagnostics, src).toEqual([]);
        expect(typecheckLowered({ "x.ts": code }), src).toEqual([]);
      }
      // the closer's overwrite and the glued statement's share an offset; both survive
      expect(compile(glued).code).toContain("void __nola_ctx_1; function __nola_ctx_1() { return __nola.ctx`be terse`; }await __nola.ask(");
    });

    it("a comment between parts is dropped, its line break kept", () => {
      const src = ["infer function go(user: string) {", "  `Analyze` /* who */ user // next", "  `now`;", "  return ask ..`v`<string>;", "}", ""].join("\n");
      const { code, diagnostics } = compile(src);
      expect(diagnostics).toEqual([]);
      expect(code).toContain("return __nola.ctx`Analyze  ${user} \n  now`; }");
    });

    it("visibility follows the binding rule: declared before the ask, in its block or an enclosing one; a value in a `for` head sees the loop body", () => {
      const src = [
        "infer function go(items: string[]) {",
        "  `Top`;",
        "  const a = ask ..`a`<string>;",
        "  for (const it of items) {",
        "    `Item` it;",
        "    const b = ask ..`b`<string>;",
        "  }",
        "  const c = ask ..`c`<string>;",
        "  `Late`;",
        "  const d = ask ..`d`<string>;",
        "  return [a, c, d];",
        "}",
        "",
      ].join("\n");
      const { code, diagnostics } = compile(src);
      expect(diagnostics.map((d) => d.code)).toEqual([]);
      expect(code).toContain("const a = await __nola.ask(__nola.intents.ExtractIntent<string>({ instruction: `a`, type: __nola_type_$2(), loc: \"3:17\", def: \"");
      expect(code).toMatch(/const a = await __nola\.ask\([^\n]*\}\), __frame, \{ context: \[__nola_ctx_1\] \}\);/);
      expect(code).toMatch(/const b = await __nola\.ask\([^\n]*\}\), __frame, \{ context: \[__nola_ctx_1, __nola_ctx_2\] \}\);/);
      expect(code).toMatch(/const c = await __nola\.ask\([^\n]*\}\), __frame, \{ context: \[__nola_ctx_1\] \}\);/);
      expect(code).toMatch(/const d = await __nola\.ask\([^\n]*\}\), __frame, \{ context: \[__nola_ctx_1, __nola_ctx_3\] \}\);/);
      expect(typecheckLowered({ "x.ts": code })).toEqual([]);
    });

    it("bindings and items share the options object; `ask with` is its model field", () => {
      const src = ["infer function go() {", '  const .tone = "brief";', "  `Be` tone;", "  return ask with fast ..`v`<string>;", "}", ""].join("\n");
      const { code, diagnostics } = compile(src);
      expect(diagnostics).toEqual([]);
      expect(code).toContain('}), __frame, { model: "fast", locals: { tone }, context: [__nola_ctx_1] });');
      expect(code).toContain('locals: [{ name: "tone" }] }));');
    });

    it("a call intent is a legal value (its extractor argument lowers normally); `ask` and a bare extractor are NOLA2010", () => {
      const ok = ["declare function foo(a: string): void;", "infer function go() {", "  `call this if needed` foo(..`user r`<string>);", "  return ask ..`v`<string>;", "}", ""].join("\n");
      const r = compile(ok);
      expect(r.diagnostics).toEqual([]);
      expect(r.code).toContain("return __nola.ctx`call this if needed ${__nola.intents.FunctionCallIntent<Awaited<ReturnType<typeof foo>>>({ fn: foo,");
      expect(typecheckLowered({ "x.ts": r.code })).toEqual([]);
      // last before the closing brace, no `;`: the closers follow the call intent's own `)` rewrite
      const tight = ["declare function foo(a: string): void;", "infer function go() {`x` foo(..`a`<string>)}", ""].join("\n");
      expect(compile(tight).code).toContain("] })}`; }  }, __nola_module_ctx().func(");
      expect(typecheckLowered({ "x.ts": compile(tight).code })).toEqual([]);
      // (a bare extractor directly after text is no value at all — NOLA1020 at parse time; parenthesized it is one)
      for (const bad of ["  `x` (ask ..`p`<string>);", "  `x` (..`p`<string>);", "  `x ${..`p`<string>} y`;"]) {
        const src = ["infer function go() {", bad, "  return ask ..`v`<string>;", "}", ""].join("\n");
        expect(compile(src).diagnostics.map((d) => d.code), bad).toEqual(["NOLA2010"]);
      }
    });

    // The stop rule ends a value at the backtick after its own base, so `foo` `hint` (…) reads as the value `foo`,
    // text, and a PARENTHESIZED group — here a bare extractor. Parenthesized, or in a hole, the hint stays with
    // its callee (the base starts after the `(` / inside the hole) and the whole call intent is one value.
    it("a HINTED call intent is a value only parenthesized or in a `${}` hole; bare, it is NOLA2010 at the extractor", () => {
      const wrap = (stmt: string) =>
        ["declare function foo(a: string): void;", "infer function go(user: string) {", stmt, "  return ask ..`v`<string>;", "}", ""].join("\n");
      for (const stmt of ["  `call` (foo`only if needed`(..`user`<string>))", "  `call ${foo`only if needed`(..`user`<string>)} now`;"]) {
        const { code, diagnostics } = compile(wrap(stmt));
        expect(diagnostics, stmt).toEqual([]);
        // the whole call intent — hint and slot included — sits inside ONE `${…}` hole
        const item = code.split("\n").find((l) => l.includes("function __nola_ctx_1()")) ?? "";
        expect(item.match(/\$\{/g), stmt).toHaveLength(1);
        expect(item, stmt).toMatch(/^ {2}void __nola_ctx_1; function __nola_ctx_1\(\) \{ return __nola\.ctx`call \$\{\(?__nola\.intents\.FunctionCallIntent<Awaited<ReturnType<typeof foo>>>\(\{ fn: foo, name: "foo", instruction: "only if needed", /);
        expect(item, stmt).toMatch(/args: \[__nola\.intents\.ExtractIntent<string>\(\{ instruction: `user`, .*\}\)\] \}\)\)?\}( now)?`; \}$/);
        expect(typecheckLowered({ "x.ts": code }), stmt).toEqual([]);
      }
      // a sigil-less call intent needs no parentheses (the existing test above), a hinted one written bare does
      const bare = wrap("  `call` foo`only if needed`(..`user`<string>)");
      const r = compile(bare);
      expect(r.diagnostics.map((d) => d.code)).toEqual(["NOLA2010"]);
      const at = bare.indexOf("..`user`");
      expect(r.diagnostics.map((d) => [d.start, d.end])).toEqual([[at, at + "..`user`<string>".length]]);
      expect(r.diagnostics[0]?.message).toContain("a hinted call intent used as a value must be parenthesized");
    });

    // Every item is a hoisted function with a `this` of its own; the parser stops a bare `this` after text
    // (NOLA1020), and one that gets past it — parenthesized, or in a hole — is the checker's TS2683.
    it("`this` in an item — a parenthesized value or a `${}` hole — lowers verbatim and TypeScript reports TS2683", () => {
      for (const stmt of ["  `Page` (this.user) `now`;", "  `Page ${this.user} now`;"]) {
        const { code, diagnostics } = compile(["infer function go() {", stmt, "  return ask ..`v`<string>;", "}", ""].join("\n"));
        expect(diagnostics, stmt).toEqual([]);
        expect(code, stmt).toMatch(/void __nola_ctx_1; function __nola_ctx_1\(\) \{ return __nola\.ctx`Page \$\{\(?this\.user\)?\} now`; \}/);
        expect(typecheckLowered({ "x.ts": code }).map((e) => e.replace(/^\S+ /, "")), stmt).toEqual([
          "TS2683: 'this' implicitly has type 'any' because it does not have a type annotation.",
        ]);
      }
    });

    it("a call on the next line is not a value: the template alone is the item, the call runs", () => {
      const src = ["infer function go() {", "  `analyze`", "  console.log('hi')", "  return ask ..`v`<string>;", "}", ""].join("\n");
      const { code, diagnostics } = compile(src);
      expect(diagnostics).toEqual([]);
      expect(code).toContain("void __nola_ctx_1; function __nola_ctx_1() { return __nola.ctx`analyze`; }\n  console.log('hi')\n");
    });

    it("two functions number their items file-wide, in source order", () => {
      const src = ["infer function a() {", "  `A`;", "  return ask ..`v`<string>;", "}", "infer function b() {", "  `B`;", "  return ask ..`v`<string>;", "}", ""].join("\n");
      const { code, diagnostics } = compile(src);
      expect(diagnostics).toEqual([]);
      expect(code).toContain("void __nola_ctx_1; function __nola_ctx_1() { return __nola.ctx`A`; }");
      expect(code).toContain("void __nola_ctx_2; function __nola_ctx_2() { return __nola.ctx`B`; }");
    });

    it("switch: a braced `case` block scopes its item to its asks; an unbraced case clause shares the switch's block, as in JavaScript", () => {
      const src = [
        "infer function go(k: number) {",
        "  switch (k) {",
        "    case 1: {",
        "      `one`;",
        "      const a = ask ..`a`<string>;",
        "      return a;",
        "    }",
        "    case 2: {",
        "      const b = ask ..`b`<string>;",
        "      return b;",
        "    }",
        "    case 3:",
        "      `three`;",
        "    case 4:",
        "      return ask ..`d`<string>;",
        "  }",
        "  const c = ask ..`c`<string>;",
        "  return c;",
        "}",
        "",
      ].join("\n");
      const { code, diagnostics } = compile(src);
      expect(diagnostics).toEqual([]);
      expect(code).toMatch(/const a = await __nola\.ask\([^\n]*\}\), __frame, \{ context: \[__nola_ctx_1\] \}\);/);
      // a sibling case's block, and the ask after the switch, see nothing
      expect(code).toMatch(/const b = await __nola\.ask\([^\n]*\}\), __frame\);/);
      expect(code).toMatch(/const c = await __nola\.ask\([^\n]*\}\), __frame\);/);
      // a declaration in a case clause is in the switch's block, visible to the clauses after it
      expect(code).toMatch(/return await __nola\.ask\([^\n]*`d`[^\n]*\}\), __frame, \{ context: \[__nola_ctx_2\] \}\);/);
      expect(typecheckLowered({ "x.ts": code })).toEqual([]);
    });
  });

  describe("in the module body", () => {
    it("top-level items go to the module init in source order; a module ask passes the ones above it; a function carries the ones above its declaration", () => {
      const src = [
        "`You triage a support inbox.`",
        "",
        "export infer function triage(.ticket: string) {",
        "  return ask ..`order id`<string>;",
        "}",
        "",
        "`Escalations go to the on-call engineer.`",
        "export const kind = ask ..`the kind`<string>;",
        "",
        "export infer function escalate(.ticket: string) {",
        "  return ask ..`step`<string>;",
        "}",
        "",
      ].join("\n");
      const { code, diagnostics } = compile(src);
      expect(diagnostics).toEqual([]);
      expect(code).toContain("void __nola_ctx_1; function __nola_ctx_1() { return __nola.ctx`You triage a support inbox.`; }\n");
      expect(code).toContain("void __nola_ctx_2; function __nola_ctx_2() { return __nola.ctx`Escalations go to the on-call engineer.`; }\n");
      expect(code).toContain('.func({ fn: "triage", args: [{ name: "ticket", type: __nola_type_$1(), contextual: true, value: ticket }], moduleContext: [__nola_ctx_1] }));');
      expect(code).toContain("}), __nola_module_ctx(), { context: [__nola_ctx_1, __nola_ctx_2] });");
      // site accessors number in source order: triage's param and extractor, the module ask's, then escalate's param
      expect(code).toContain('.func({ fn: "escalate", args: [{ name: "ticket", type: __nola_type_$4(), contextual: true, value: ticket }], moduleContext: [__nola_ctx_1, __nola_ctx_2] }));');
      expect(code).toContain('function __nola_module_ctx() { return __nola.context.module("x.tsi", 21, () => ({ context: [__nola_ctx_1, __nola_ctx_2] })); }');
      expect(typecheckLowered({ "x.ts": code })).toEqual([]);
    });

    it("a block-scoped module item is passed by the asks in its block and never listed in the init or a function's view", () => {
      const src = [
        "`Top`;",
        "for (const m of ['a']) {",
        "  `Item` m;",
        "  const v = ask ..`v`<string>;",
        "}",
        "const w = ask ..`w`<string>;",
        "export infer function f() {",
        "  return ask ..`x`<string>;",
        "}",
        "",
      ].join("\n");
      const { code, diagnostics } = compile(src);
      expect(diagnostics).toEqual([]);
      expect(code).toMatch(/const v = await __nola\.ask\([^\n]*\}\), __nola_module_ctx\(\), \{ context: \[__nola_ctx_1, __nola_ctx_2\] \}\);/);
      expect(code).toMatch(/const w = await __nola\.ask\([^\n]*\}\), __nola_module_ctx\(\), \{ context: \[__nola_ctx_1\] \}\);/);
      expect(code).toContain('.func({ fn: "f", moduleContext: [__nola_ctx_1] }));');
      expect(code).toContain('() => ({ context: [__nola_ctx_1] })); }');
      expect(typecheckLowered({ "x.ts": code })).toEqual([]);
    });

    it("an exported type glued to an item keeps its value declaration in front of the item", () => {
      const src = "export type T = { a: string };`text`\nexport const v = ask ..`v`<string>;\n";
      const { code, diagnostics } = compile(src);
      expect(diagnostics).toEqual([]);
      expect(code).toContain('TypeValueOf<typeof __nola_type_T, T>;void __nola_ctx_1; function __nola_ctx_1() { return __nola.ctx`text`; }\n');
      expect(typecheckLowered({ "x.ts": code })).toEqual([]);
    });

    it("a file with no ask and no infer function keeps its lone text statements byte-identical", () => {
      const src = "`just text`\nconst s = `a ${1}`;\nexport type T = { a: string };\n";
      const { code, diagnostics } = compile(src);
      expect(diagnostics).toEqual([]);
      expect(code.startsWith("`just text`\nconst s = `a ${1}`;\n")).toBe(true);
      expect(code).not.toContain("__nola_ctx_");
    });

    it("a statement of two or more parts makes every context statement in the file an item — alone it is no valid JS", () => {
      // the lone text comes FIRST: the rule is the file's, settled before the walk
      const src = "const user = 'ada';\n`note`;\n`Page` user;\n";
      const { code, diagnostics } = compile(src);
      expect(diagnostics).toEqual([]);
      expect(code.slice(0, code.indexOf("\n;\nimport { __nola }"))).toBe(
        "const user = 'ada';\nvoid __nola_ctx_1; function __nola_ctx_1() { return __nola.ctx`note`; }\nvoid __nola_ctx_2; function __nola_ctx_2() { return __nola.ctx`Page ${user}`; }\n",
      );
      expect(code).toContain("__nola.useRuntime(21);");
      expect(code).toContain(
        'function __nola_module_ctx() { return __nola.context.module("x.tsi", 21, () => ({ context: [__nola_ctx_1, __nola_ctx_2] })); }',
      );
      expect(typecheckLowered({ "x.ts": code })).toEqual([]);
      // a chain of templates counts the same (alone it throws at run time)
      expect(compile("`a`\n`b`;\n").code).toContain("void __nola_ctx_1; function __nola_ctx_1() { return __nola.ctx`a\nb`; }");
    });
  });

  describe("outside a scope body — NOLA2017", () => {
    // [what, source, the statement the diagnostic covers]
    for (const [what, src, stmt] of [
      ["a plain function", "function plain() {\n  `text` 1 `more`;\n}\n", "`text` 1 `more`;"],
      [
        "a callback inside an infer body",
        "infer function go(items: string[]) {\n  items.forEach((p) => {\n    `note` p;\n  });\n  return ask ..`v`<string>;\n}\n",
        "`note` p;",
      ],
      ["a lone template in a plain function", "function plain() {\n  `text`;\n}\n", "`text`;"],
      ["a class static block", "class A {\n  static {\n    `text`;\n  }\n}\n", "`text`;"],
      ["a namespace body", "namespace N {\n  `text`;\n}\n", "`text`;"],
      ["a multi-line statement in a plain function", "function plain(user: string) {\n  `text` user\n  `more`;\n}\n", "`text` user\n  `more`;"],
      // an unbraced body has no block for the item to be visible in, and a function declaration is illegal there
      [
        "an unbraced `if` body inside an infer body",
        "infer function go(x: boolean, user: string) {\n  if (x) `text` user;\n  return ask ..`v`<string>;\n}\n",
        "`text` user;",
      ],
      [
        "an unbraced `else` body in the module body",
        "declare const x: boolean;\nif (x) {\n} else `text`;\nexport const v = ask ..`v`<string>;\n",
        "`text`;",
      ],
      ["an unbraced loop body", "infer function go(xs: string[]) {\n  for (const x of xs) `item` x;\n  return ask ..`v`<string>;\n}\n", "`item` x;"],
      ["a labeled statement", "infer function go() {\n  here: `text`;\n  return ask ..`v`<string>;\n}\n", "`text`;"],
    ] as const) {
      it(`${what}: NOLA2017 at the statement, lowered to the inert text under a broken span, line count kept`, () => {
        // compile() holds the line count: the inert text keeps the statement's line terminators
        const { code, diagnostics, meta } = compile(src);
        expect(diagnostics.map((d) => d.code), what).toEqual(["NOLA2017"]);
        const at = src.indexOf(stmt);
        expect(diagnostics.map((d) => [d.start, d.end]), what).toEqual([[at, at + stmt.length]]);
        expect(code, what).toContain("(undefined as never);");
        expect(meta.spans.filter((s) => s.kind === "broken").map((s) => [s.sourceStart, s.sourceEnd]), what).toEqual([
          [at, at + stmt.length],
        ]);
      });
    }

    it("inside a call hint's hole: NOLA2017, and nothing is overwritten — the hint's copy already replaced the bytes", () => {
      const src = [
        "declare function f(a: string): void;",
        "infer function go() {",
        "  return ask f`use ${[1].map((i) => { `note` i; return i; })}`(..`a`<string>);",
        "}",
        "",
      ].join("\n");
      for (const tolerant of [false, true]) {
        // both modes: strict used to throw "Cannot split a chunk that has already been edited"; tolerant served stale output
        const { diagnostics, meta } = compile(src, { tolerant });
        const at = src.indexOf("`note` i;");
        expect(diagnostics.map((d) => [d.code, d.start, d.end]), `tolerant: ${tolerant}`).toEqual([["NOLA2017", at, at + "`note` i;".length]]);
        expect(meta.mode).toBe("lowered");
      }
    });
  });

  describe("tolerant mode", () => {
    it("a half-typed value lowers verbatim (TypeScript reports the name); the file keeps lowering", () => {
      const src = ["infer function go(oncall: string) {", "  `Page` onc", "  return ask ..`v`<string>;", "}", ""].join("\n");
      const r = compile(src, { tolerant: true });
      expect(r.meta.mode).toBe("lowered");
      expect(r.diagnostics).toEqual([]);
      expect(r.code).toContain("return __nola.ctx`Page ${onc}`; }");
    });

    it("NOLA1020's recovery: the statement ends before the token, which lowers as its own statement", () => {
      const src = ["infer function go(user: string) {", "  `text` user + 1;", "  return ask ..`v`<string>;", "}", ""].join("\n");
      const r = compile(src, { tolerant: true });
      expect(r.meta.mode).toBe("lowered");
      expect(r.diagnostics.map((d) => d.code)).toEqual(["NOLA1020"]);
      expect(r.code).toContain("return __nola.ctx`text ${user}`; } + 1;");
    });
  });
});
