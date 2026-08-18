import { INTENT_BRAND, type Intent, type JsonSchema, type NolaProvider } from "@nola-lang/core";
import { describe, expect, expectTypeOf, it } from "vitest";

describe("core Intent contract", () => {
  it("INTENT_BRAND is the string brand", () => {
    expect(INTENT_BRAND).toBe("nola.intent");
  });

  it("a thenable with fluent methods satisfies Intent<T>", async () => {
    const fake: Intent<number> = {
      __nolaBrand: INTENT_BRAND,
      // biome-ignore lint/suspicious/noThenProperty: Intent is intentionally a thenable (PromiseLike)
      then: (f) => Promise.resolve(1).then(f),
      withRetry() {
        return fake;
      },
    };
    expect(await fake).toBe(1);
  });

  it("JsonSchema covers scalars, arrays, objects", () => {
    const s: JsonSchema = {
      type: "object",
      properties: { id: { type: "string", description: "GUID" }, tags: { type: "array", items: { type: "string" } } },
      required: ["id"],
      additionalProperties: false,
    };
    expect(s.type).toBe("object");
  });

  it("NolaProvider.complete returns { text }", () => {
    const p: NolaProvider = { name: "noop", complete: async () => ({ text: '"x"' }) };
    expectTypeOf(p.complete).returns.resolves.toEqualTypeOf<{ text: string }>();
    expect(p.name).toBe("noop");
  });
});
