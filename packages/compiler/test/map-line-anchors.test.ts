import { originalPositionFor, TraceMap } from "@jridgewell/trace-mapping";
import { compileNola } from "@nola-lang/compiler";
import { describe, expect, it } from "vitest";

/**
 * Debugger contract for the v3 map: no generated line inside replaced text may
 * begin unmapped. The infer-function wrapper adds two whole generated lines —
 * the opener (`return __nola.intents.Intent(...)`) and the closer
 * (`}, __nola_module_ctx().func(...))`). Without a line-start anchor, a
 * downstream esbuild merge attributes the closer to the LAST BODY TOKEN via
 * its line-start carry segment (observed: F11 into an infer function displayed
 * `return valid;` while paused in construction), and the opener's unmapped
 * entry pause makes js-debug smart-step past the function header.
 */

const WITH_CONTEXT = [
  "export infer function analyzeAddress(.address: string) {",
  "  `checker`",
  "  const valid = ask ..`is it valid`<boolean>;",
  "  return valid;",
  "}",
  "",
].join("\n");

const BARE = [
  "export infer function analyzeAddress(.address: string) {",
  "  const valid = ask ..`is it valid`<boolean>;",
  "  return valid;",
  "}",
  "",
].join("\n");

const WITH_HOLED_CONTEXT = [
  "export infer function analyzeAddress(.address: string) {",
  // biome-ignore lint/suspicious/noTemplateCurlyInString: literal ${...} in .tsi fixture source
  "  `checker for ${address}`",
  "  const valid = ask ..`is it valid`<boolean>;",
  "  return valid;",
  "}",
  "",
].join("\n");

function genPosOf(code: string, needle: string): { line: number; column: number } {
  const offset = code.indexOf(needle);
  expect(offset, `generated code contains ${JSON.stringify(needle)}`).toBeGreaterThanOrEqual(0);
  const upTo = code.slice(0, offset);
  return { line: upTo.split("\n").length, column: offset - (upTo.lastIndexOf("\n") + 1) };
}

describe.each([
  // the opener sits at `{` in every case since context statements (spec 2026-09-29 §3.3): an item is a hoisted function inside the executor
  { name: "with a context statement", source: WITH_CONTEXT, openerLine: 1, closeBraceLine: 5 },
  { name: "with a holed context statement", source: WITH_HOLED_CONTEXT, openerLine: 1, closeBraceLine: 5 },
  { name: "without one", source: BARE, openerLine: 1, closeBraceLine: 4 },
])("wrapper lines carry line-start source anchors ($name)", ({ source, openerLine, closeBraceLine }) => {
  const r = compileNola(source, "t.tsi");
  it("compiles clean", () => {
    expect(r.diagnostics).toEqual([]);
  });
  const tracer = new TraceMap(r.map as never);

  it("the invocation opener maps to the header line", () => {
    const gen = genPosOf(r.code, "return __nola.intents.Intent(");
    expect(originalPositionFor(tracer, gen).line).toBe(openerLine);
  });

  it("the invocation closer maps to the close-brace line, never the last body line", () => {
    const gen = genPosOf(r.code, "__nola_module_ctx().func(");
    expect(originalPositionFor(tracer, gen).line).toBe(closeBraceLine);
  });

  it("the arrow's closing brace (the executor return position) maps to the close-brace line", () => {
    const gen = genPosOf(r.code, "}, __nola_module_ctx()");
    expect(originalPositionFor(tracer, gen).line).toBe(closeBraceLine);
  });

  it("the appendix stays unmapped", () => {
    const gen = genPosOf(r.code, "__nola.useRuntime(");
    expect(originalPositionFor(tracer, gen).line).toBeNull();
  });
});
