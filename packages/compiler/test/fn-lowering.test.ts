// biome-ignore-all lint/suspicious/noTemplateCurlyInString: .tsi fixtures and lowered output contain literal ${} interpolation
import { compileNola } from "@nola-lang/compiler";
import { describe, expect, it } from "vitest";
import { defHash } from "../src/lower/templates.js";

const SRC = ["infer function go(a: string) {", "  const v = ask ..`v from ${a}`<string>;", "  return v;", "}", ""].join(
  "\n",
);

// Phase-1 output (emit 15): the param annotation and the extractor's <T> are
// site accessors with inert bodies; finalizeDerivations fills them in.
const OUT = [
  "function go(a: string) {",
  "  return __nola.intents.Intent(async (__frame) => { void a;",
  `  const v = await __nola.ask(__nola.intents.ExtractIntent<string>({ instruction: \`v from \${__nola.fmt(a)}\`, type: __nola_type_$2(), loc: "2:17", def: "${defHash("x.tsi", "extract", "v from ${a}", "string")}" }), __frame);`,
  "  return v;",
  '  }, __nola_module_ctx().func({ fn: "go", args: [{ name: "a", type: __nola_type_$1() }] }));',
  "}",
  "",
  ";",
  'import { __nola } from "@nola-lang/runtime";',
  "__nola.useRuntime(21);",
  'function __nola_module_ctx() { return __nola.context.module("x.tsi", 21); }',
  'function __nola_type_$1(): import("@nola-lang/runtime").InferType<unknown> | undefined { return (undefined as never); }',
  'function __nola_type_$2(): import("@nola-lang/runtime").InferType<unknown> { return (undefined as never); }',
  "",
].join("\n");

describe("infer function lowering", () => {
  it("reproduces the spec §2 normative shape exactly", () => {
    const { code, diagnostics, meta } = compileNola(SRC, "x.tsi");
    expect(diagnostics).toEqual([]);
    expect(code).toBe(OUT);
    expect(meta.nolaFunctions).toEqual(["go"]);
  });

  it("the body's first statement is a context item the ask passes", () => {
    const src = "export infer function getUser(m: string) {\n  `extract the user`\n  return ask ..`u from ${m}`;\n}\n";
    const { code, diagnostics } = compileNola(src, "x.tsi");
    expect(diagnostics).toEqual([]);
    expect(code).toContain("export function getUser(m: string) {\n  return __nola.intents.Intent(async (__frame) => { void m;\n  void __nola_ctx_1; function __nola_ctx_1() { return __nola.ctx`extract the user`; }\n");
    expect(code).toContain("}), __frame, { context: [__nola_ctx_1] });");
    expect(code).toContain('.func({ fn: "getUser", args: [{ name: "m", type: __nola_type_$1() }] })');
  });

  it("NOLA2001: ask inside a plain function", () => {
    const src = "async function plain() {\n  return ask ..`v`;\n}\n";
    const { diagnostics } = compileNola(src, "x.tsi");
    expect(diagnostics.map((d) => d.code)).toContain("NOLA2001");
  });

  it("NOLA2001: ask in a class field initializer or static block — await is illegal there", () => {
    for (const member of ["v = ask ..`v`;", "static { ask ..`v`; }"]) {
      const { diagnostics } = compileNola(`class C {\n  ${member}\n}\n`, "x.tsi");
      expect(diagnostics.map((d) => d.code)).toContain("NOLA2001");
    }
    const inBody = "infer function go() {\n  class C { v = ask ..`v`; }\n  return C;\n}\n";
    expect(compileNola(inBody, "x.tsi").diagnostics.map((d) => d.code)).toContain("NOLA2001");
  });

  it("NOLA2001: ask inside a nested plain closure", () => {
    const src = "infer function go() {\n  const f = () => ask ..`v`;\n  return f;\n}\n";
    const { diagnostics } = compileNola(src, "x.tsi");
    expect(diagnostics.map((d) => d.code)).toContain("NOLA2001");
  });

  it("NOLA2003: infer function not at top level", () => {
    const src = "function outer() {\n  infer function inner() {\n    return 1;\n  }\n}\n";
    const { diagnostics } = compileNola(src, "x.tsi");
    expect(diagnostics.map((d) => d.code)).toContain("NOLA2003");
  });

  it("await stays legal inside infer bodies", () => {
    const src = "infer function go(p: Promise<number>) {\n  const n = await p;\n  return n;\n}\n";
    const { code, diagnostics } = compileNola(src, "x.tsi");
    expect(diagnostics).toEqual([]);
    expect(code).toContain("const n = await p;");
  });

  it("free-standing extractor at module level stays legal", () => {
    const { diagnostics } = compileNola("const i = ..`user name`;\n", "x.tsi");
    expect(diagnostics).toEqual([]);
  });

  it("the emitted module accessor is reachable from a same-module top-level call", async () => {
    // The module accessor is appended at EOF, after the call site. A `const`
    // (or `var`) there is in its TDZ (or `undefined`) when an infer function is
    // invoked during its own module's evaluation — only a hoisted function
    // declaration initializes early enough.
    const src = "infer function go() {\n  return ask ..`v`;\n}\nexport const eager = go();\n";
    const { code, diagnostics } = compileNola(src, "x.tsi");
    expect(diagnostics).toEqual([]);

    const scopes: Array<Record<string, unknown>> = [];
    const __nola = {
      intents: { Intent: (_e: unknown, scope: unknown) => ({ scope }) },
      context: { module: (file: string) => ({ func: (d: Record<string, unknown>) => ({ file, ...d }) }) },
      useRuntime: () => {},
    };
    // Evaluate the lowered module body with the runtime import stripped, mirroring
    // ESM: hoisted declarations first, statements in source order.
    const body = code.replace(/^import \{ __nola \}.*$/m, "").replace(/^export const/m, "const");
    const run = new Function("__nola", "scopes", `${body}\nscopes.push(eager.scope);`);
    expect(() => run(__nola, scopes)).not.toThrow();
    expect(scopes[0]).toEqual({ file: "x.tsi", fn: "go" });
  });

  it("an eager call in a module with a context item reaches the node with its init — nothing evaluates early", () => {
    const src = "`Be terse.`\ninfer function go() {\n  return ask ..`v`;\n}\nexport const eager = go();\n";
    const { code, diagnostics } = compileNola(src, "x.tsi");
    expect(diagnostics).toEqual([]);
    const inits: unknown[] = [];
    const scopes: Array<Record<string, unknown>> = [];
    const __nola = {
      intents: { Intent: (_e: unknown, scope: unknown) => ({ scope }) },
      context: {
        module: (file: string, _emit: number, init?: () => Record<string, unknown>) => {
          inits.push(init?.());
          return { func: (d: Record<string, unknown>) => ({ file, ...d }) };
        },
      },
      ctx: (strings: TemplateStringsArray) => strings.join(""),
      useRuntime: () => {},
    };
    const body = code.replace(/^import \{ __nola \}.*$/m, "").replace(/^export const/m, "const");
    const run = new Function("__nola", "scopes", `${body}\nscopes.push(eager.scope);`);
    expect(() => run(__nola, scopes)).not.toThrow();
    // the item is a hoisted declaration: the init and the function's view reference it, and it renders when read
    const init = inits[0] as { context: Array<() => string> };
    expect(init).toEqual({ context: [expect.any(Function)] });
    expect(init.context.map((item) => item())).toEqual(["Be terse."]);
    expect(scopes[0]).toEqual({ file: "x.tsi", fn: "go", moduleContext: init.context });
  });

  it("harvests params: name + site accessor for annotated ones, contextual+value for `..` params", () => {
    const src = [
      "type User = { name: string };",
      "infer function analyze(.user: User, limit: number) {",
      "  return 1;",
      "}",
      "",
    ].join("\n");
    const { code, diagnostics, meta } = compileNola(src, "x.tsi");
    expect(diagnostics).toEqual([]);
    expect(code).toContain(
      '.func({ fn: "analyze", args: [' +
        '{ name: "user", type: __nola_type_$1(), contextual: true, value: user }, ' +
        '{ name: "limit", type: __nola_type_$2() }] })',
    );
    // the `..` bytes are stripped from the lowered param list
    expect(code).toContain("function analyze(user: User, limit: number)");
    // a contextual param follows the configured policy; a plain one derives under "omit"
    expect(meta.derivations.map((d) => [d.accessor, d.kind, d.policy])).toEqual([
      ["__nola_type_$1", "context", "error"],
      ["__nola_type_$2", "context", "omit"],
    ]);
    expect(src.slice(meta.derivations[0]?.source.start, meta.derivations[0]?.source.end)).toBe("User");
    expect(code.slice(meta.derivations[1]?.lowered.start, meta.derivations[1]?.lowered.end)).toBe("number");
  });

  it("an unannotated param omits `type`; an annotated plain param gets a site accessor (the checker decides derivability)", () => {
    const src = "infer function go(x, cb: () => void) {\n  return 1;\n}\n";
    const { code, diagnostics } = compileNola(src, "x.tsi");
    expect(diagnostics).toEqual([]);
    expect(code).toContain('.func({ fn: "go", args: [{ name: "x" }, { name: "cb", type: __nola_type_$1() }] })');
  });

  it("the executor captures every param — unused ones stay debug-hoverable", () => {
    // V8 drops variables a closure never references: a `.user` the body does
    // not mention would be optimized out of the executor's scope, and the
    // debugger's evaluate("user") throws ReferenceError — hover shows nothing.
    // The opener's `void (...)` read forces capture; it lives on the unmapped
    // wrapper line, so stepping never sees it.
    const src = [
      "type User = { name: string };",
      "infer function analyze(.user: User, limit: number) {",
      "  return 1;",
      "}",
      "",
    ].join("\n");
    const { code, diagnostics } = compileNola(src, "x.tsi");
    expect(diagnostics).toEqual([]);
    expect(code).toContain("return __nola.intents.Intent(async (__frame) => { void user; void limit;");
  });

  it("zero-param functions emit no capture statement and no args key", () => {
    const { code } = compileNola("infer function go() {\n  return 1;\n}\n", "x.tsi");
    expect(code).toContain("Intent(async (__frame) => {\n");
    expect(code).not.toContain("void ");
  });

  it("zero-param functions emit no args key (fingerprint-stable shape)", () => {
    const { code } = compileNola("infer function go() {\n  return 1;\n}\n", "x.tsi");
    expect(code).toContain('.func({ fn: "go" }));');
    expect(code).not.toContain("args:");
  });

  it("two infer functions lower independently", () => {
    const src = "infer function a() {\n  return ask ..`x`;\n}\ninfer function b() {\n  return ask ..`y`;\n}\n";
    const { code, meta, diagnostics } = compileNola(src, "x.tsi");
    expect(diagnostics).toEqual([]);
    expect(meta.nolaFunctions).toEqual(["a", "b"]);
    expect(code.match(/__nola\.intents\.Intent\(async \(__frame\) => \{/g)).toHaveLength(2);
  });
});

// The underivable-contextual-param policy (error / prune / omit) is applied by
// the checker pass: see packages/derive/test/service.test.ts and
// packages/compiler/test/finalize.test.ts. Phase 1 only records the policy on
// the request (see "harvests params" above).

describe("context statement holes (spec 2026-09-29 §3.3)", () => {
  it("NOLA2010: a Nola construct inside a context statement's hole", () => {
    const src = "infer function go() {\n  `${..`x`} rules`\n  return 1;\n}\n";
    expect(compileNola(src, "x.tsi").diagnostics.map((d) => d.code)).toContain("NOLA2010");
  });
});
