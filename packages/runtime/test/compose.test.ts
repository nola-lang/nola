import { buildInferenceModel, ExtractContext, Frame, nolaRuntime, inferTypes as t } from "@nola-lang/runtime";
import { afterEach, describe, expect, it } from "vitest";
import { classicText } from "./helpers/model.js";

afterEach(() => nolaRuntime.reset());

const runtime = () => nolaRuntime.current();

const extractCtx = (instruction = "ticket id mentioned in the message") =>
  new ExtractContext({ instruction, type: { type: "string" }, loc: "1:1" }, runtime());

describe("composeInferenceData", () => {
  it("composes the canonical CONTEXT + TASK prompt", () => {
    const fnCtx = runtime()
      .moduleContext("src/test_2/analyze.tsi")
      .func({
        fn: "analyzeUserRequest",
        args: [
          { name: "message", type: t.string(), contextual: true, value: "Ticket TCK-4711: help." },
          { name: "userId", contextual: false },
        ],
      });
    const frame = Frame.open(fnCtx).child(extractCtx());

    const text = classicText(frame);

    expect(buildInferenceModel({ frame, context: frame.infer, site: "t" }).output).toEqual({
      syntax: "json",
      schema: { type: "string" },
    });
    expect(text).toBe(
      [
        '<context function="analyzeUserRequest">',
        '<input name="message">',
        "Ticket TCK-4711: help.",
        "</input>",
        "</context>",
        "",
        "<task>",
        "ticket id mentioned in the message",
        "</task>",
      ].join("\n"),
    );
  });

  it("renders the visible items as the block's first lines, and no input for zero args", () => {
    const fnCtx = runtime().moduleContext("x.tsi").func({ fn: "go" });
    const text = classicText(Frame.open(fnCtx).child(extractCtx("p"), { visible: { context: [() => "be careful"] } }));
    expect(text).toContain('<context function="go">\nbe careful\n</context>\n\n<task>');
    expect(text).not.toContain("<input");
  });

  it("renders the caller's block before the callee's, with no relation words", () => {
    const file = runtime().moduleContext("x.tsi");
    const root = Frame.open(file.func({ fn: "caller" }));
    const callee = root.child(file.func({ fn: "callee" }));
    const text = classicText(callee.child(extractCtx("p")));
    expect(text).toContain('<context function="caller"/>');
    expect(text).toContain('<context function="callee"/>');
    expect(text.indexOf('function="caller"')).toBeLessThan(text.indexOf('function="callee"'));
    expect(text).not.toContain("called from");
  });

  it("a contextual arg without a value is a self-closing input", () => {
    const fnCtx = runtime()
      .moduleContext("x.tsi")
      .func({ fn: "go", args: [{ name: "hint", contextual: true }] });
    const text = classicText(Frame.open(fnCtx).child(extractCtx("p")));
    expect(text).toContain('<input name="hint"/>');
    expect(text).not.toContain("undefined");
  });

  it("multiline string values are written verbatim inside their input", () => {
    const fnCtx = runtime()
      .moduleContext("x.tsi")
      .func({ fn: "go", args: [{ name: "m", contextual: true, value: "line1\nline2" }] });
    const text = classicText(Frame.open(fnCtx).child(extractCtx("p")));
    expect(text).toContain('<input name="m">\nline1\nline2\n</input>');
  });

  it("long and short strings alike are written verbatim, never JSON-quoted", () => {
    const long = "x".repeat(121);
    const fnCtx = runtime()
      .moduleContext("x.tsi")
      .func({
        fn: "go",
        args: [
          { name: "big", contextual: true, value: long },
          { name: "small", contextual: true, value: "tiny" },
        ],
      });
    const text = classicText(Frame.open(fnCtx).child(extractCtx("p")));
    expect(text).toContain(`<input name="big">\n${long}\n</input>`);
    expect(text).toContain('<input name="small">\ntiny\n</input>');
  });

  it("the schema never appears in the prompt — it rides structured output", () => {
    const fnCtx = runtime().moduleContext("x.tsi").func({ fn: "go" });
    const extract = new ExtractContext(
      { instruction: "pick one", type: { type: "string", enum: ["gold", "silver"] }, loc: "1:1" },
      runtime(),
    );
    const text = classicText(Frame.open(fnCtx).child(extract));
    expect(text).toContain("<task>\npick one\n</task>");
    expect(text).not.toContain('"enum"');
    expect(text).not.toContain("RESPONSE SCHEMA");
  });

  it("is the task block alone when nothing composed a context", () => {
    const text = classicText(Frame.open(extractCtx("p")));
    expect(text).toBe(["<task>", "p", "</task>"].join("\n"));
  });
});
