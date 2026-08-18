import type { ComposeOptions, InferenceComposer } from "@nola-lang/runtime";
import { ExtractInferContext, Frame, InferContext, nolaRuntime, PromptBuilder } from "@nola-lang/runtime";
import { afterEach, describe, expect, it } from "vitest";

afterEach(() => nolaRuntime.reset());
const runtime = () => nolaRuntime.current();
const extract = () => new ExtractInferContext({ instruction: "p", type: { type: "string" }, loc: "1:1" }, runtime());

/** A node that wraps the remainder — what a template reading `.next` does. */
class WrapNode extends InferContext<Record<string, unknown>> {
  constructor(
    private readonly label: string,
    parent: InferContext,
  ) {
    super(Object.freeze({}), parent.runtime, parent);
  }
  override contributesText(): boolean {
    return true;
  }
  override composeInferenceData(composer: InferenceComposer, opts?: ComposeOptions): void {
    composer.addText(`<${this.label} ctx=${opts?.hasContext}>\n${opts?.next?.() ?? ""}\n</${this.label}>`);
  }
}

describe("PromptBuilder continuation walk", () => {
  it("lets an outer node wrap everything after it; hasContext reflects contributing predecessors", () => {
    const file = runtime().fileContext("x.tsi");
    const outer = new WrapNode("outer", file);
    const callee = Frame.open(outer).child(file.func({ fn: "callee" }));
    const { messages } = new PromptBuilder().build(callee, extract());
    expect(messages[0]?.content).toBe(
      [
        "<outer ctx=false>",
        "CONTEXT — inside callee(), x.tsi, called from the context above",
        "",
        "TASK",
        "Produce the data requested below from the context above.",
        "<request>",
        "p",
        "</request>",
        "Respond with a single JSON string containing the value.",
        "</outer>",
      ].join("\n"),
    );
  });

  it("a bare scope node contributes nothing and passes the remainder through", () => {
    const bare = runtime().fileContext("x.tsi").scope({ k: 1 });
    const { messages } = new PromptBuilder().build(Frame.open(bare), extract());
    expect(messages[0]?.content.startsWith("TASK\nProduce the data requested below.\n")).toBe(true);
  });

  it("next is memoized — reading it twice composes once", () => {
    let composed = 0;
    class Leaf extends WrapNode {
      override composeInferenceData(c: InferenceComposer): void {
        composed++;
        c.addText("leaf");
      }
    }
    class Twice extends WrapNode {
      override composeInferenceData(c: InferenceComposer, opts?: ComposeOptions): void {
        c.addText(`${opts?.next?.()}|${opts?.next?.()}`);
      }
    }
    const file = runtime().fileContext("x.tsi");
    const { messages } = new PromptBuilder().build(Frame.open(new Twice("t", file)), new Leaf("l", file));
    expect(messages[0]?.content).toBe("leaf|leaf");
    expect(composed).toBe(1);
  });
});
