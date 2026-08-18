import { originalPositionFor, TraceMap } from "@jridgewell/trace-mapping";
import { compileNola } from "@nola-lang/compiler";
import { describe, expect, it } from "vitest";

/**
 * Debugger contract for the v3 map: no generated line inside replaced text may
 * begin unmapped. The infer-function wrapper adds two whole generated lines —
 * the opener (`return __nola.intents.Intent(...)`) and the closer
 * (`}, __nola_file_ctx().func(...))`). Without a line-start anchor, a
 * downstream esbuild merge attributes the closer to the LAST BODY TOKEN via
 * its line-start carry segment (observed: F11 into an infer function displayed
 * `return valid;` while paused in construction), and the opener's unmapped
 * entry pause makes js-debug smart-step past the function header.
 */

const SOURCE = [
  "export infer function analyzeAddress`checker`(.address: string) {",
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

describe("wrapper lines carry line-start source anchors", () => {
  const r = compileNola(SOURCE, "t.tsi");
  it("compiles clean", () => {
    expect(r.diagnostics).toEqual([]);
  });
  const tracer = new TraceMap(r.map as never);

  it("the invocation opener maps to the function header line", () => {
    const gen = genPosOf(r.code, "return __nola.intents.Intent(");
    const orig = originalPositionFor(tracer, gen);
    expect(orig.line).toBe(1);
  });

  it("the invocation closer maps to the close-brace line, never the last body line", () => {
    const gen = genPosOf(r.code, "__nola_file_ctx().func(");
    const orig = originalPositionFor(tracer, gen);
    expect(orig.line).toBe(4);
  });

  it("the arrow's closing brace (the executor return position) maps to the close-brace line", () => {
    const gen = genPosOf(r.code, "}, __nola_file_ctx()");
    const orig = originalPositionFor(tracer, gen);
    expect(orig.line).toBe(4);
  });

  it("the appendix stays unmapped", () => {
    const gen = genPosOf(r.code, "__nola.useRuntime(");
    const orig = originalPositionFor(tracer, gen);
    expect(orig.line).toBeNull();
  });
});
