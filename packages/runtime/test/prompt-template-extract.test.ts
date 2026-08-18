// biome-ignore-all lint/suspicious/noTemplateCurlyInString: raw instruction strings carry literal ${} holes
import { mockProvider } from "@nola-lang/providers";
import {
  ask,
  ExtractInferContext,
  ExtractIntent,
  Frame,
  FunctionCallingIntent,
  nolaRuntime,
  PromptBuilder,
  inferTypes as t,
} from "@nola-lang/runtime";
import { afterEach, describe, expect, it } from "vitest";

afterEach(() => nolaRuntime.reset());
const runtime = () => nolaRuntime.current();
const FORMAT_STRING = "Respond with a single JSON string containing the value.";
const FORMAT_NUMBER = 'RESPONSE SCHEMA (JSON Schema):\n{"type":"number"}\nRespond with a single JSON value strictly conforming to the schema above.';

describe("extractor prompt template", () => {
  it("replaces the TASK block; .format is appended when not read", () => {
    const node = new ExtractInferContext(
      {
        instruction: "raw ${.type}",
        type: t.string(),
        loc: "1:1",
        template: (s) => `Give me: ${s.type} / ${s.schema} / ctx=${s.hasContext}`,
      },
      runtime(),
    );
    const frame = Frame.open(runtime().fileContext("x.tsi").func({ fn: "go" }));
    const { messages } = new PromptBuilder().build(frame, node);
    expect(messages[0]?.content).toBe(
      `CONTEXT — inside go(), x.tsi\n\nGive me: string / {"type":"string"} / ctx=true\n\n${FORMAT_STRING}`,
    );
  });

  it("places .format where it is read and exposes .default (the whole built-in TASK block)", () => {
    const node = new ExtractInferContext(
      { instruction: "p", type: t.number(), loc: "1:1", template: (s) => `${s.format}\n---\n${s.default}` },
      runtime(),
    );
    const { messages } = new PromptBuilder().build(Frame.open(runtime().fileContext("x.tsi").scope({})), node);
    expect(messages[0]?.content).toBe(
      `${FORMAT_NUMBER}\n---\nTASK\nProduce the data requested below.\n<request>\np\n</request>\n${FORMAT_NUMBER}`,
    );
  });

  it("a call-intent hint template reaches the synthesized slot ask", async () => {
    const seen: string[] = [];
    runtime().configure({
      providers: {
        default: mockProvider((req) => {
          seen.push(req.messages[0]?.content ?? "");
          return { arg0: "x" };
        }),
      },
    });
    const target = (v: string) => v.toUpperCase();
    const intent = new FunctionCallingIntent<string>(
      {
        fn: target,
        name: "target",
        instruction: "hint",
        loc: "1:1",
        args: [new ExtractIntent<string>({ instruction: "value", type: t.string(), loc: "1:2" }, runtime())],
        template: (s) => `CALL ${s.type.length > 0 ? "typed" : "untyped"}\n${s.default}`,
      },
      runtime(),
    );
    const frame = Frame.open(runtime().fileContext("x.tsi").func({ fn: "go" }));
    const out = await ask(intent, frame);
    expect(out).toBe("X");
    expect(seen[0]).toContain("CALL typed\nTASK\n");
    expect(seen[0]).toContain('Generate the arguments for calling the function "target". hint');
  });
});
