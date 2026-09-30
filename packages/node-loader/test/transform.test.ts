import { NolaTransformError, transformNola } from "@nola-lang/node-loader";
import { describe, expect, it } from "vitest";

describe("transformNola", () => {
  it("produces runnable ESM JS (types stripped, ask lowered) with a merged map", async () => {
    const src = [
      "export infer function go(q: string) {",
      "  const v = ask ..`value`<string>;",
      "  return v;",
      "}",
      "",
    ].join("\n");
    const { code, map } = await transformNola(src, "go.tsi");
    expect(code).toContain("await __nola.ask(");
    expect(code).toContain("__nola.intents.Intent(async (__frame)");
    // Node's strip mode leaves whitespace where the annotation was (layout preserved)
    expect(code).toMatch(/function go\(q\s*\)/);
    expect(code).not.toContain(": string");
    const parsed = JSON.parse(map) as { sources: string[] };
    expect(parsed.sources).toContain("go.tsi");
  });

  it("map sources bind the debugger: absolute .tsi path in forward-slash form, content embedded", async () => {
    // js-debug matches breakpoints in a .tsi through the loader's inline map;
    // that only works when `sources` is a clean absolute path to the on-disk
    // file (a malformed entry like `d://work//...` breaks URL resolution and
    // the breakpoint silently never binds).
    const file = process.platform === "win32" ? "d:\\proj\\src\\go.tsi" : "/proj/src/go.tsi";
    const src = "export infer function go(q: string) {\n  const v = ask ..`value`<string>;\n  return v;\n}\n";
    const { map } = await transformNola(src, file);
    const parsed = JSON.parse(map) as { sources: string[]; sourcesContent?: (string | null)[] };
    expect(parsed.sources).toEqual([file.replace(/\\/g, "/")]);
    expect(parsed.sources[0]).not.toMatch(/\/\//);
    expect(parsed.sourcesContent?.[0]).toBe(src);
  });

  it("merged map leaves the wrapper unmapped so stepping walks through construction", async () => {
    // The debugger contract (opposite of the compiler map, which anchors the
    // wrapper lines for `nola build` maps and `nola check`): under js-debug,
    // UNMAPPED positions are smart-stepped, so the infer wrapper must carry NO
    // segments — F11 on `ask fn(...)` then lands in the callee's body instead
    // of touring intent construction. Crucially that includes esbuild's
    // line-start carry segment, which would otherwise re-attribute the closer
    // line to the body's LAST token: the original bug displayed `return v;`
    // while the debugger was actually paused in construction.
    const src = [
      "export infer function go(q: string) {",
      "  const v = ask ..`value`<string>;",
      "  return v;",
      "}",
      "",
    ].join("\n");
    const { code, map } = await transformNola(src, "go.tsi");
    const { TraceMap, originalPositionFor } = await import("@jridgewell/trace-mapping");
    const tracer = new TraceMap(JSON.parse(map));
    const genPos = (needle: string) => {
      const offset = code.indexOf(needle);
      expect(offset, `generated code contains ${JSON.stringify(needle)}`).toBeGreaterThanOrEqual(0);
      const upTo = code.slice(0, offset);
      return { line: upTo.split("\n").length, column: offset - (upTo.lastIndexOf("\n") + 1) };
    };
    // the wrapper opener and closer are unmapped (smart-step territory)
    expect(originalPositionFor(tracer, genPos("return __nola.intents.Intent(")).line).toBeNull();
    expect(originalPositionFor(tracer, genPos("}, __nola_module_ctx()")).line).toBeNull();
    expect(originalPositionFor(tracer, genPos("__nola_module_ctx().func(")).line).toBeNull();
    // body statements keep their precise mappings (breakpoints must bind)
    expect(originalPositionFor(tracer, genPos("await __nola.ask("))).toMatchObject({ line: 2 });
    expect(originalPositionFor(tracer, genPos("return v;"))).toMatchObject({ line: 3 });
  });

  it("throws NolaTransformError carrying diagnostics on parse errors", async () => {
    try {
      await transformNola("const = 1;", "bad.tsi");
      expect.unreachable("should throw");
    } catch (e) {
      expect(e).toBeInstanceOf(NolaTransformError);
      const err = e as NolaTransformError;
      expect(err.diagnostics[0]?.code).toBe("NOLA1001");
      expect(err.message).toContain("bad.tsi:1:");
    }
  });

  it("throws on compile diagnostics too (ask in a plain function)", async () => {
    await expect(transformNola("const f = async () => ask ..`v`;\n", "top.tsi")).rejects.toThrow(/NOLA2001/);
  });
});

describe("transformNola keeps the lowered layout (js-debug binds .tsi breakpoints raw AND mapped)", () => {
  // js-debug sets a .tsi breakpoint twice: through the inline map, and by raw
  // URL + line on the compiled script — whose URL IS the .tsi path. If type
  // stripping collapsed lines (esbuild dropped a 6-line interface), raw line 8
  // landed inside the appendix's __nola_module_ctx, which the ask calls: F10 over
  // a top-level ask then paused in unmapped code and degraded into a continue.
  const src = [
    "export interface Person {",
    "  name: string;",
    "  age: number;",
    "  employer: string;",
    "  job: string;",
    "}",
    "",
    'const .message = "Alice Smith, 32";',
    "",
    "const person = ask ..`the person described in the text`<Person>;",
    "",
    "console.log(JSON.stringify(person));",
    "",
  ].join("\n");

  it("every body statement stays on its source line; the appendix starts after the last source line", async () => {
    const { code } = await transformNola(src, "main.tsi");
    const lines = code.split("\n");
    expect(lines[7]).toMatch(/^const message = "Alice Smith, 32";/);
    expect(lines[9]).toMatch(/^const person = await __nola\.ask\(/);
    expect(lines[11]).toBe("console.log(JSON.stringify(person));");
    const appendixAt = lines.findIndex((l) => l.startsWith('import { __nola } from "@nola-lang/runtime";'));
    expect(appendixAt).toBeGreaterThanOrEqual(src.split("\n").length - 1);
  });

  it("the map agrees with the raw layout: generated line N maps to source line N for body statements", async () => {
    const { code, map } = await transformNola(src, "main.tsi");
    const { TraceMap, originalPositionFor } = await import("@jridgewell/trace-mapping");
    const tracer = new TraceMap(JSON.parse(map));
    const lineOf = (needle: string) => code.slice(0, code.indexOf(needle)).split("\n").length;
    for (const [needle, line] of [
      ["const message =", 8],
      ["const person = await", 10],
      ["console.log(", 12],
    ] as const) {
      expect(lineOf(needle)).toBe(line);
      expect(originalPositionFor(tracer, { line, column: 0 })).toMatchObject({ line });
    }
  });

  it("a multi-line context statement (module or infer body) keeps its lines, so later statements keep theirs", async () => {
    // The statement stays in place as a hoisted function spanning the same
    // lines (spec 2026-09-29 §3.7): js-debug's raw copy of a breakpoint on the
    // ask line binds to the ask line, and one on the statement's line binds to
    // its `void` read, the statement's own step location.
    const moduleSrc = [
      "`",
      "You are a UI resolver for a workflow builder.",
      "`",
      "",
      "const result = ask `find the users`<string>",
      "",
      "console.log(result);",
      "",
    ].join("\n");
    const { code, map } = await transformNola(moduleSrc, "main.tsi");
    const lines = code.split("\n");
    expect(lines[0]).toBe("void __nola_ctx_1; function __nola_ctx_1() { return __nola.ctx`");
    expect(lines[1]).toBe("You are a UI resolver for a workflow builder.");
    expect(lines[2]).toBe("`; }");
    expect(lines[3]).toBe("");
    expect(lines[4]).toMatch(/^const result = await __nola\.ask\(/);
    expect(lines[4]).toContain("__nola_module_ctx(), { context: [__nola_ctx_1] })");
    expect(lines[6]).toBe("console.log(result);");
    const { TraceMap, originalPositionFor } = await import("@jridgewell/trace-mapping");
    const tracer = new TraceMap(JSON.parse(map));
    expect(originalPositionFor(tracer, { line: 5, column: 0 })).toMatchObject({ line: 5 });
    expect(originalPositionFor(tracer, { line: 7, column: 0 })).toMatchObject({ line: 7 });
    // the statement's own lines are mapped too: a breakpoint on the text line binds through the map, not only raw
    expect(originalPositionFor(tracer, { line: 2, column: 0 })).toMatchObject({ line: 2 });
    expect(originalPositionFor(tracer, { line: 3, column: 0 })).toMatchObject({ line: 3 });

    // text and value parts over two lines, in a body: every line keeps its number
    const bodySrc = [
      "export infer function go(.q: string, oncall: string) {",
      "  `Page` oncall",
      "  `when the ticket is an outage.`",
      "  const v = ask `the value`<string>;",
      "  return v;",
      "}",
      "",
    ].join("\n");
    const body = await transformNola(bodySrc, "go.tsi");
    const bodyLines = body.code.split("\n");
    // the wrapper opener adds one line after the header; the body's own lines hold
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the lowered text contains a literal ${} hole
    expect(bodyLines[2]).toBe("  void __nola_ctx_1; function __nola_ctx_1() { return __nola.ctx`Page ${oncall}");
    expect(bodyLines[3]).toBe("  when the ticket is an outage.`; }");
    const askAt = bodyLines.findIndex((l) => l.includes("const v = await __nola.ask("));
    expect(askAt).toBe(4);
    const bodyTracer = new TraceMap(JSON.parse(body.map));
    expect(originalPositionFor(bodyTracer, { line: askAt + 1, column: 2 })).toMatchObject({ line: 4 });
    expect(originalPositionFor(bodyTracer, { line: askAt + 2, column: 2 })).toMatchObject({ line: 5 });
    // the statement's own line is mapped (source line 2 = generated line 3), and so is its continuation line
    // (source line 3 = generated line 4): it begins inside replaced text — the gap re-emitted between the value
    // and the next text — but carries the statement's own text, so it is no wrapper line
    expect(originalPositionFor(bodyTracer, { line: 3, column: 2 })).toMatchObject({ line: 2 });
    expect(originalPositionFor(bodyTracer, { line: 4, column: 2 })).toMatchObject({ line: 3 });
  });

  it("a column-0 context statement's own line is mapped: a breakpoint on the file's first line binds through the map at the statement's own position", async () => {
    // Playground report (2026-09-29): a breakpoint on a module-level statement at column 0 opened the
    // generated script instead of the .tsi. The in-place opener is an INSERT at the statement's first
    // byte, so its line begins inside replaced text like the infer opener/closer lines do — but unlike
    // them it carries the statement's verbatim text, and that text must keep its segments.
    const src = [
      "`You are a request solver.`;",
      "",
      "const .query = `two orders`;",
      "",
      "const requests: string[] = [];",
      "",
      "`Processed orders:` requests;",
      "",
      "while (requests.length < 2) {",
      "  `return null once every order is processed`",
      "  const next = ask `the next order`<string | null>;",
      "  if (next) requests.push(next);",
      "  else break;",
      "}",
      "",
    ].join("\n");
    const { code, map } = await transformNola(src, "main.tsi");
    const lines = code.split("\n");
    expect(lines[0]).toBe("void __nola_ctx_1; function __nola_ctx_1() { return __nola.ctx`You are a request solver.`; }");
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the lowered text contains a literal ${} hole
    expect(lines[6]).toBe("void __nola_ctx_2; function __nola_ctx_2() { return __nola.ctx`Processed orders: ${requests}`; }");
    expect(lines[9]).toBe("  void __nola_ctx_3; function __nola_ctx_3() { return __nola.ctx`return null once every order is processed`; }");
    const { TraceMap, originalPositionFor } = await import("@jridgewell/trace-mapping");
    const tracer = new TraceMap(JSON.parse(map));
    // js-debug binds the breakpoint at column 0 — the `void __nola_ctx_N;` read, the statement's step
    // location (templates.ts `contextItemOpen`), where V8 resolves it and pauses in source order; F11 into
    // an ask can still land on the `return` inside the item — both positions must display the statement's line
    for (const [line, needle] of [
      [1, "return __nola.ctx`You"],
      [7, "return __nola.ctx`Processed"],
      [10, "return __nola.ctx`return"],
    ] as const) {
      expect(originalPositionFor(tracer, { line, column: 0 }), `line ${line} at column 0`).toMatchObject({ line });
      const column = lines[line - 1].indexOf(needle);
      expect(column, `line ${line} holds ${needle}`).toBeGreaterThan(0);
      expect(originalPositionFor(tracer, { line, column }), `line ${line} at the item's return`).toMatchObject({ line });
    }
  });

  it("a context statement mid-body, inside a block, keeps every line: source line N is generated line N + 1 (spec 2026-09-29 §6)", async () => {
    // The hoisted function sits in the for block on the statement's own line, and the ask beside it sees it.
    const src = [
      "export infer function go(.q: string, steps: string[]) {",
      "  const seen: string[] = [];",
      "  for (const s of steps) {",
      "    `Steps so far:` seen;",
      "    const v = ask `the next step`<string>;",
      "    seen.push(v);",
      "  }",
      "  return seen;",
      "}",
      "",
    ].join("\n");
    const { code, map } = await transformNola(src, "mid.tsi");
    const lines = code.split("\n");
    // the wrapper opener adds one line after the header; every body line N is generated line N + 1
    expect(lines[2]).toMatch(/^ {2}const seen/);
    expect(lines[3]).toBe("  for (const s of steps) {");
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the lowered text contains a literal ${} hole
    expect(lines[4]).toBe("    void __nola_ctx_1; function __nola_ctx_1() { return __nola.ctx`Steps so far: ${seen}`; }");
    expect(lines[5]).toContain("const v = await __nola.ask(");
    expect(lines[5]).toContain("__frame, { context: [__nola_ctx_1] })");
    expect(lines[6]).toBe("    seen.push(v);");
    expect(lines[7]).toBe("  }");
    expect(lines[8]).toBe("  return seen;");
    const { TraceMap, originalPositionFor } = await import("@jridgewell/trace-mapping");
    const tracer = new TraceMap(JSON.parse(map));
    for (const line of [2, 3, 4, 5, 6, 7, 8]) {
      expect(originalPositionFor(tracer, { line: line + 1, column: 2 }), `generated line ${line + 1}`).toMatchObject({ line });
    }
  });

  it("non-erasable syntax (an enum) falls back to a transforming strip with a map that still binds", async () => {
    const enumSrc = [
      "export enum Kind {",
      '  Billing = "billing",',
      '  Refund = "refund",',
      "}",
      "export infer function go(q: string) {",
      "  const k = ask ..`the kind`<Kind>;",
      "  return k;",
      "}",
      "",
    ].join("\n");
    const { code, map } = await transformNola(enumSrc, "kind.tsi");
    expect(code).not.toMatch(/\benum\b/);
    expect(code).toContain("Kind");
    const { TraceMap, originalPositionFor } = await import("@jridgewell/trace-mapping");
    const tracer = new TraceMap(JSON.parse(map));
    const offset = code.indexOf("await __nola.ask(");
    const upTo = code.slice(0, offset);
    const pos = { line: upTo.split("\n").length, column: offset - (upTo.lastIndexOf("\n") + 1) };
    expect(originalPositionFor(tracer, pos)).toMatchObject({ line: 6 });
  });
});
