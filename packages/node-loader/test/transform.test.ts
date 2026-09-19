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
    expect(originalPositionFor(tracer, genPos("}, __nola_file_ctx()")).line).toBeNull();
    expect(originalPositionFor(tracer, genPos("__nola_file_ctx().func(")).line).toBeNull();
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
  // landed inside the appendix's __nola_file_ctx, which the ask calls: F10 over
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
