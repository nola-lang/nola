import { renderClassic } from "@nola-lang/core";
import { buildInferenceModel, ExtractContext, Frame, nolaRuntime, inferTypes as t } from "@nola-lang/runtime";
import { afterEach, describe, expect, it } from "vitest";
import { FunctionCallContext } from "../src/intents/function-call/function-call-context.js";
import { openTestFrame } from "./helpers/frame.js";

afterEach(() => nolaRuntime.reset());
const runtime = () => nolaRuntime.current();
const extract = (instruction = "p") => new ExtractContext({ instruction, type: t.string(), loc: "1:1" }, runtime());
const build = (frame: Frame, context = extract(), system?: string) =>
  buildInferenceModel({ frame, context, site: "x.tsi:1:1", ...(system !== undefined ? { system } : {}) });

describe("ModelBuilder", () => {
  it("builds the canonical model: intent, resolved arg types, innermost-first scope chain, wire schema", () => {
    const file = runtime().fileContext("src/a.tsi");
    const root = Frame.open(file.func({ fn: "caller", instruction: "be careful" }));
    const callee = root.child(
      file.func({
        fn: "callee",
        args: [
          { name: "m", type: t.string(), contextual: true, value: "v" },
          { name: "n", contextual: false },
        ],
      }),
    );
    expect(build(callee, extract("p"), "Be terse.")).toEqual({
      intent: "extract",
      input: { instruction: "p" },
      scope: {
        fn: "callee",
        file: "src/a.tsi",
        instruction: "",
        args: [
          { name: "m", type: "string", contextual: true, value: "v" },
          { name: "n", contextual: false },
        ],
        parent: { fn: "caller", file: "src/a.tsi", instruction: "be careful", args: [] },
      },
      system: "Be terse.",
      output: { syntax: "json", schema: { type: "string" } },
    });
  });

  it("a bare scope frame describes nothing: no scope, no parent link, and JSON-clean output", () => {
    const bare = Frame.open(runtime().fileContext("x.tsi").scope({ k: 1 }));
    const model = build(bare);
    expect(model.scope).toBeUndefined();
    expect(JSON.parse(JSON.stringify(model))).toEqual(model);
    const viaBare = Frame.open(runtime().fileContext("x.tsi").scope({})).child(runtime().fileContext("x.tsi").func({ fn: "go" }));
    expect(build(viaBare).scope).toEqual({ fn: "go", file: "x.tsi", instruction: "", args: [] });
  });

  it("the ask-site node may also sit in the frame chain (a child frame over an extract node)", () => {
    const fn = runtime().fileContext("x.tsi").func({ fn: "go" });
    const frame = Frame.open(fn).child(extract("q"));
    const model = buildInferenceModel({ frame, context: frame.infer, site: "x.tsi:1:1" });
    expect(model.input.instruction).toBe("q");
    expect(model.scope?.fn).toBe("go");
    expect(renderClassic(model).messages[0]?.content).toContain("CONTEXT — inside go(), x.tsi\n\nTASK");
  });

  it("JSON-normalizes a contextual arg's value (a Date renders as its ISO string, keeping fingerprints stable)", () => {
    const fn = runtime()
      .fileContext("x.tsi")
      .func({
        fn: "go",
        args: [{ name: "d", contextual: true, value: new Date("2026-01-02T03:04:05.000Z") }],
      });
    const model = build(Frame.open(fn));
    expect(model.scope?.args[0]).toEqual({ name: "d", contextual: true, value: "2026-01-02T03:04:05.000Z" });
  });

  it("a contextual arg whose value has no JSON form (a function) is omitted, not a crash", () => {
    const fn = runtime()
      .fileContext("x.tsi")
      .func({
        fn: "go",
        args: [{ name: "cb", contextual: true, value: () => 1 }],
      });
    const model = build(Frame.open(fn));
    expect(model.scope?.args[0]).toEqual({ name: "cb", contextual: true });
  });

  it("the built model is frozen — a hook or provider cannot mutate the canonical ask", () => {
    const fn = runtime()
      .fileContext("x.tsi")
      .func({ fn: "go", args: [{ name: "n", contextual: true, value: 1 }] });
    const model = build(Frame.open(fn));
    expect(Object.isFrozen(model)).toBe(true);
    expect(Object.isFrozen(model.scope)).toBe(true);
    expect(Object.isFrozen(model.scope?.args)).toBe(true);
    expect(Object.isFrozen(model.scope?.args[0])).toBe(true);
    expect(Object.isFrozen(model.output)).toBe(true);
  });
});

describe("ModelBuilder — call intents", () => {
  it("a FunctionCallContext with slots composes intent: call with callee and hint", () => {
    const frame = openTestFrame();
    const node = new FunctionCallContext(
      { fn: () => 1, name: "notify", instruction: "urgently", args: [] },
      runtime(),
    ).forSlots(t.object({ arg0: t.string() }));
    const model = buildInferenceModel({ frame, context: node, site: "x.tsi:1:1" });
    expect(model.intent).toBe("call");
    expect(model.input).toMatchObject({
      instruction: 'Generate the arguments for calling the function "notify". urgently',
      callee: "notify",
      hint: "urgently",
    });
  });
});
