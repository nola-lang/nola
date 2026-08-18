import { __nola, inferTypes as t } from "@nola-lang/runtime";
import { describe, expect, it } from "vitest";

describe("intents accept InferType as the type carrier", () => {
  it("ExtractIntent.spec resolves an InferType to plain JsonSchema", () => {
    const intent = __nola.intents.ExtractIntent<{ name: string }>({
      instruction: "who",
      type: t.object({ name: t.string() }),
      loc: "1:1",
    });
    expect((intent as unknown as { spec: { schema: unknown } }).spec.schema).toEqual({
      type: "object",
      properties: { name: { type: "string" } },
      required: ["name"],
      additionalProperties: false,
    });
  });

  it("a plain JsonSchema init still works unchanged", () => {
    const intent = __nola.intents.ExtractIntent<string>({ instruction: "m", type: { type: "string" }, loc: "1:1" });
    expect((intent as unknown as { spec: { schema: unknown } }).spec.schema).toEqual({ type: "string" });
  });
});
