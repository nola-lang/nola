// biome-ignore-all lint/suspicious/noTemplateCurlyInString: .tsi fixtures and lowered output contain literal ${} interpolation
import { compileNola } from "@nola-lang/compiler";
import { describe, expect, it } from "vitest";

const SRC = ["infer function go(a: string) {", "  const v = ask ..`v from ${a}`<string>;", "  return v;", "}", ""].join(
  "\n",
);

const OUT = [
  "function go(a: string) {",
  "  return __nola.intents.Intent(async (__frame) => { void a;",
  '  const v = await __nola.ask(__nola.intents.ExtractIntent<string>({ instruction: `v from ${__nola.fmt(a)}`, type: __nola.types.string(), loc: "2:17" }), __frame);',
  "  return v;",
  '  }, __nola_file_ctx().func({ fn: "go", instruction: "", args: [{ name: "a", type: __nola.types.string() }] }));',
  "}",
  "",
  'import { __nola } from "@nola-lang/runtime";',
  "__nola.useRuntime(11);",
  'function __nola_file_ctx() { return __nola.context.file("x.tsi"); }',
  "",
].join("\n");

describe("infer function lowering", () => {
  it("reproduces the spec §2 normative shape exactly", () => {
    const { code, diagnostics, meta } = compileNola(SRC, "x.tsi");
    expect(diagnostics).toEqual([]);
    expect(code).toBe(OUT);
    expect(meta.nolaFunctions).toEqual(["go"]);
  });

  it("carries the marker instruction into the scope", () => {
    const src = "export infer function getUser`extract the user`(m: string) {\n  return ask ..`u from ${m}`;\n}\n";
    const { code, diagnostics } = compileNola(src, "x.tsi");
    expect(diagnostics).toEqual([]);
    expect(code).toContain("export function getUser(m: string) {");
    expect(code).toContain(
      '.func({ fn: "getUser", instruction: "extract the user", args: [{ name: "m", type: __nola.types.string() }] })',
    );
    expect(code).not.toContain("`extract the user`");
  });

  it("NOLA2001: ask at module top level", () => {
    const { diagnostics } = compileNola("const v = ask ..`v`;\n", "x.tsi");
    expect(diagnostics.map((d) => d.code)).toContain("NOLA2001");
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

  it("the emitted file context is reachable from a same-module top-level call", async () => {
    // The file-context accessor is appended at EOF, after the call site. A `const`
    // (or `var`) there is in its TDZ (or `undefined`) when an infer function is
    // invoked during its own module's evaluation — only a hoisted function
    // declaration initializes early enough.
    const src = "infer function go() {\n  return ask ..`v`;\n}\nexport const eager = go();\n";
    const { code, diagnostics } = compileNola(src, "x.tsi");
    expect(diagnostics).toEqual([]);

    const scopes: Array<Record<string, unknown>> = [];
    const __nola = {
      intents: { Intent: (_e: unknown, scope: unknown) => ({ scope }) },
      context: { file: (file: string) => ({ func: (d: Record<string, unknown>) => ({ file, ...d }) }) },
      useRuntime: () => {},
    };
    // Evaluate the lowered module body with the runtime import stripped, mirroring
    // ESM: hoisted declarations first, statements in source order.
    const body = code.replace(/^import \{ __nola \}.*$/m, "").replace(/^export const/m, "const");
    const run = new Function("__nola", "scopes", `${body}\nscopes.push(eager.scope);`);
    expect(() => run(__nola, scopes)).not.toThrow();
    expect(scopes[0]).toEqual({ file: "x.tsi", fn: "go", instruction: "" });
  });

  it("harvests params: name+type for all, contextual+value for `..` params", () => {
    const src = [
      "type User = { name: string };",
      "infer function analyze(.user: User, limit: number) {",
      "  return 1;",
      "}",
      "",
    ].join("\n");
    const { code, diagnostics } = compileNola(src, "x.tsi");
    expect(diagnostics).toEqual([]);
    expect(code).toContain(
      '.func({ fn: "analyze", instruction: "", args: [' +
        '{ name: "user", type: __nola.types.ref("User", __nola_type_User), contextual: true, value: user }, ' +
        '{ name: "limit", type: __nola.types.number() }] })',
    );
    // the `..` bytes are stripped from the lowered param list
    expect(code).toContain("function analyze(user: User, limit: number)");
    expect(code).toContain("function __nola_type_User()");
  });

  it("unannotated and underivable param types omit `type` without a diagnostic", () => {
    const src = "infer function go(x, cb: () => void) {\n  return 1;\n}\n";
    const { code, diagnostics } = compileNola(src, "x.tsi");
    expect(diagnostics).toEqual([]);
    expect(code).toContain('.func({ fn: "go", instruction: "", args: [{ name: "x" }, { name: "cb" }] })');
  });

  it("a Date member derives (emit 9): the param type refs an accessor carrying types.date()", () => {
    const src = [
      "type User = { name: string; dob: Date };",
      "infer function analyze(.user: User) {",
      "  return 1;",
      "}",
      "",
    ].join("\n");
    const { code, diagnostics } = compileNola(src, "x.tsi");
    expect(diagnostics).toEqual([]);
    expect(code).toContain(
      '.func({ fn: "analyze", instruction: "", args: [' +
        '{ name: "user", type: __nola.types.ref("User", __nola_type_User), contextual: true, value: user }] })',
    );
    expect(code).toContain("dob: __nola.types.date()");
    expect(code).toContain("function __nola_type_User()");
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
    expect(code).toContain('.func({ fn: "go", instruction: "" }));');
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

describe("underivable contextual param policy (compiler.underivableContextType)", () => {
  // ref("User", __nola_type_User) derivation is lazy: the shallow ref succeeds
  // and only the accessor-body derivation sees the unsupported function member.
  const POISONED = [
    "type User = { name: string; cb: () => void };",
    "infer function analyze(.user: User) {",
    "  return 1;",
    "}",
    "",
  ].join("\n");

  it("error (the default): NOLA2008 at the param type annotation, no type emitted", () => {
    const { code, diagnostics } = compileNola(POISONED, "x.tsi");
    expect(diagnostics).toHaveLength(1);
    const d = diagnostics[0] as (typeof diagnostics)[0];
    expect(d.code).toBe("NOLA2008");
    expect(d.message).toContain("'user'");
    expect(d.message).toContain("underivableContextType");
    expect(POISONED.slice(d.start, d.end)).toBe("User");
    expect(code).not.toContain("__nola_type_User");
  });

  it("error: a shallowly underivable annotation diagnoses too", () => {
    const src = "infer function go(.cb: () => void) {\n  return 1;\n}\n";
    const { diagnostics } = compileNola(src, "x.tsi");
    expect(diagnostics.map((d) => d.code)).toEqual(["NOLA2008"]);
  });

  it("error: plain params stay exempt — only `..` contextual params diagnose", () => {
    const src = "infer function go(cb: () => void) {\n  return 1;\n}\n";
    const { code, diagnostics } = compileNola(src, "x.tsi");
    expect(diagnostics).toEqual([]);
    expect(code).toContain('args: [{ name: "cb" }]');
  });

  it("omit: yesterday's silent behavior, now an explicit opt-in — no dangling accessor ref", () => {
    const { code, diagnostics } = compileNola(POISONED, "x.tsi", { underivableContextType: "omit" });
    expect(diagnostics).toEqual([]);
    expect(code).toContain(
      '.func({ fn: "analyze", instruction: "", args: [{ name: "user", contextual: true, value: user }] })',
    );
    expect(code).not.toContain("__nola_type_User");
  });

  it("prune: drops the underivable member, keeps the rest", () => {
    const { code, diagnostics } = compileNola(POISONED, "x.tsi", { underivableContextType: "prune" });
    expect(diagnostics).toEqual([]);
    expect(code).toContain(
      '.func({ fn: "analyze", instruction: "", args: [' +
        '{ name: "user", type: __nola.types.ref("User", __nola_type_User), contextual: true, value: user }] })',
    );
    expect(code).toContain("return __nola.types.object({ name: __nola.types.string() });");
  });

  it("prune: a nested inline object loses just the bad field", () => {
    const src = [
      "type User = { name: string; meta: { level: number; cb: () => void } };",
      "infer function analyze(.user: User) {",
      "  return 1;",
      "}",
      "",
    ].join("\n");
    const { code, diagnostics } = compileNola(src, "x.tsi", { underivableContextType: "prune" });
    expect(diagnostics).toEqual([]);
    expect(code).toContain(
      "return __nola.types.object({ name: __nola.types.string(), meta: __nola.types.object({ level: __nola.types.number() }) });",
    );
  });

  it("prune: a member referencing a fully-underivable named type is dropped (dead-ref iteration)", () => {
    const src = [
      "type Handler = { cb: () => void };",
      "type User = { name: string; handler: Handler };",
      "infer function analyze(.user: User) {",
      "  return 1;",
      "}",
      "",
    ].join("\n");
    const { code, diagnostics } = compileNola(src, "x.tsi", { underivableContextType: "prune" });
    expect(diagnostics).toEqual([]);
    expect(code).toContain("return __nola.types.object({ name: __nola.types.string() });");
    expect(code).not.toContain("__nola_type_Handler");
  });

  it("prune: a type that prunes to nothing falls back to omit", () => {
    const src = ["type Bare = { cb: () => void };", "infer function analyze(.b: Bare) {", "  return 1;", "}", ""].join(
      "\n",
    );
    const { code, diagnostics } = compileNola(src, "x.tsi", { underivableContextType: "prune" });
    expect(diagnostics).toEqual([]);
    expect(code).toContain('args: [{ name: "b", contextual: true, value: b }]');
    expect(code).not.toContain("__nola_type_Bare");
  });

  it("prune: recursion through a prunable type still derives (cycle-safe)", () => {
    const src = [
      "type Node = { next?: Node; cb: () => void };",
      "infer function walk(.n: Node) {",
      "  return 1;",
      "}",
      "",
    ].join("\n");
    const { code, diagnostics } = compileNola(src, "x.tsi", { underivableContextType: "prune" });
    expect(diagnostics).toEqual([]);
    expect(code).toContain(
      'return __nola.types.object({ next: __nola.types.optional(__nola.types.ref("Node", __nola_type_Node)) });',
    );
  });

  it("prune: a fully derivable type emits byte-identically to the default path", () => {
    const src = [
      "type User = { name: string };",
      "infer function analyze(.user: User) {",
      "  return 1;",
      "}",
      "",
    ].join("\n");
    const strict = compileNola(src, "x.tsi").code;
    const pruned = compileNola(src, "x.tsi", { underivableContextType: "prune" }).code;
    expect(pruned).toBe(strict);
  });

  it("extract sites keep their hard error in every mode", () => {
    const src = ["type Bad = { cb: () => void };", "infer function go() {", "  return ask ..`v`<Bad>;", "}", ""].join(
      "\n",
    );
    for (const mode of ["error", "prune", "omit"] as const) {
      const { diagnostics } = compileNola(src, "x.tsi", { underivableContextType: mode });
      expect(diagnostics.map((d) => d.code)).toContain("NOLA2002");
    }
  });
});

describe("infer-function marker templates (${.member})", () => {
  it("copies a scope-hole marker into a template closure at the body close; instruction keeps the raw text", () => {
    const src = "infer function go`CTX ${.signature}\n${.args.map(a => `- ${a.name}`)}\n${.next}`(.m: string) {\n  return m;\n}\n";
    const { code, diagnostics, meta } = compileNola(src, "x.tsi");
    expect(diagnostics).toEqual([]);
    expect(code).toContain("function go(m: string) {");
    expect(code).toContain(
      '.func({ fn: "go", instruction: "CTX ${.signature}\\n${.args.map(a => `- ${a.name}`)}\\n${.next}", template: (__nola_s) => __nola.tpl`CTX ${__nola_s.signature}\n${__nola_s.args.map(a => `- ${a.name}`)}\n${__nola_s.next}`, args: [{ name: "m", type: __nola.types.string(), contextual: true, value: m }] })',
    );
    // the marker's verbatim runs are anchored back to the source
    const anchored = meta.anchors.map((a) => src.slice(a.sourceStart, a.sourceEnd));
    expect(anchored).toContain("`CTX ${");
    expect(anchored).toContain(".signature}\n${");
    // and every anchor's generated range holds the same bytes
    for (const a of meta.anchors) {
      expect(code.slice(a.generatedStart, a.generatedEnd)).toBe(src.slice(a.sourceStart, a.sourceEnd));
    }
  });

  it("a lexical-only marker lowers to a per-invocation template literal with fmt", () => {
    const src = "const G = 'g';\ninfer function go`follow ${G}`() {\n  return 1;\n}\n";
    const { code, diagnostics } = compileNola(src, "x.tsi");
    expect(diagnostics).toEqual([]);
    expect(code).toContain('.func({ fn: "go", instruction: `follow ${__nola.fmt(G)}` })');
  });

  it("NOLA2010: a Nola construct inside a marker hole", () => {
    const src = "infer function go`${..`x`} ${.next}`() {\n  return 1;\n}\n";
    const { diagnostics } = compileNola(src, "x.tsi");
    expect(diagnostics.map((d) => d.code)).toContain("NOLA2010");
  });
});
