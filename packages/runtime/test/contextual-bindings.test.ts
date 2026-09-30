import { renderPrompt } from "@nola-lang/core";
import { __nola, buildInferenceModel, ExtractContext, Frame, nolaRuntime } from "@nola-lang/runtime";
import { afterEach, describe, expect, it } from "vitest";

afterEach(() => nolaRuntime.reset());

const extract = () => __nola.intents.ExtractIntent<string>({ instruction: "a label", type: { type: "string" }, loc: "3:15" });

/** A probe model: records every classic rendering it is sent. */
function probe(payloads: string[]) {
  nolaRuntime.configure({
    model: {
      default: {
        name: "probe",
        infer: async (req) => {
          payloads.push(renderPrompt(req.intent).messages[0]?.content ?? "");
          return { text: '"x"' };
        },
      },
    },
  });
}

describe("contextual bindings (scope-bodies spec §3.3 / §3.4)", () => {
  it("infer body: the ask-site locals join the function's CONTEXT block after its parameters", async () => {
    const payloads: string[] = [];
    probe(payloads);
    const file = __nola.context.module("x.tsi");
    const go = (q: string) =>
      __nola.intents.Intent(
        async (__frame: Frame) => {
          const tone = "brief";
          return __nola.ask(extract(), __frame, { locals: { tone } });
        },
        file.func({
          fn: "go",
          args: [{ name: "q", type: __nola.types.string(), contextual: true, value: q }],
          locals: [{ name: "tone", type: __nola.types.string() }],
        }),
      );
    await go("hello");
    const p = payloads[0] ?? "";
    expect(p).toContain('<context function="go">');
    expect(p).toContain('<input name="q">\nhello\n</input>\n<input name="tone">\nbrief\n</input>');
  });

  it("module body: locals give the <module> scope a CONTEXT block; none means no block", async () => {
    const payloads: string[] = [];
    probe(payloads);
    const scope = __nola.context.module("main.tsi", undefined, () => ({ locals: [{ name: "tone" }] }));
    await __nola.ask(extract(), scope, { locals: { tone: "brief" } });
    expect(payloads[0]).toContain('<context module="main.tsi">\n<input name="tone">\nbrief\n</input>\n</context>');
    expect(payloads[0]).toContain("<task>");

    await __nola.ask(extract(), scope);
    expect(payloads[1]).not.toContain("CONTEXT");
  });

  it("the wire model marks the module scope and its local entries (additive fields)", () => {
    nolaRuntime.configure({ model: { default: { name: "m", infer: async () => ({ text: '"x"' }) } } });
    const runtime = nolaRuntime.current();
    const scope = runtime.moduleContext("main.tsi", () => ({ locals: [{ name: "tone" }] }));
    const context = new ExtractContext({ instruction: "a label", type: { type: "string" }, loc: "3:15" }, runtime);
    const model = buildInferenceModel({ frame: Frame.open(scope), context, site: "main.tsi:3:15", visible: { locals: { tone: "brief" } } });
    expect(model.scope).toMatchObject({ fn: "<module>", module: true, file: "main.tsi", args: [{ name: "tone", contextual: true, value: "brief", local: true }] });
    expect(buildInferenceModel({ frame: Frame.open(scope), context, site: "main.tsi:3:15" }).scope).toBeUndefined();
  });

  it("`ask fn()` hands the caller's locals to the callee as the caller scope's context", async () => {
    const payloads: string[] = [];
    probe(payloads);
    const file = __nola.context.module("x.tsi");
    const callee = () =>
      __nola.intents.Intent(
        async (__frame: Frame) => __nola.ask(extract(), __frame),
        file.func({ fn: "callee" }),
      );
    const caller = () =>
      __nola.intents.Intent(
        async (__frame: Frame) => {
          const tone = "brief";
          return __nola.ask(callee(), __frame, { locals: { tone } });
        },
        file.func({ fn: "caller", locals: [{ name: "tone" }] }),
      );
    await caller();
    const p = payloads[0] ?? "";
    expect(p).toContain('<context function="caller">\n<input name="tone">\nbrief\n</input>\n</context>');
    expect(p).toContain('<context function="callee"/>');
  });

  it("a local reads its value at the ask — a reassigned `let .x` contributes the current one", async () => {
    const payloads: string[] = [];
    probe(payloads);
    const scope = __nola.context.module("main.tsi", undefined, () => ({ locals: [{ name: "n" }] }));
    let n = 1;
    n = 2;
    await __nola.ask(extract(), scope, { locals: { n } });
    expect(payloads[0]).toContain('<input name="n">\n2\n</input>');
  });
});
