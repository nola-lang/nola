import type { InferenceModel } from "@nola-lang/core";
import { redactDeep } from "@nola-lang/core";
import { describe, expect, expectTypeOf, it } from "vitest";

/** An obviously fake key that still has a real key's shape (nothing key-shaped is committed as a literal). */
const FAKE_KEY = `sk-proj-${"A".repeat(24)}`;

describe("InferenceModel", () => {
  it("is plain JSON data: a literal satisfies the type and survives a JSON round trip", () => {
    const model: InferenceModel = {
      intent: "extract",
      input: { instruction: "the person described in the text" },
      scope: {
        fn: "extractPerson",
        file: "src/person.tsi",
        instruction: "",
        args: [{ name: "message", type: "string", contextual: true, value: "Alice" }],
        parent: { fn: "main", instruction: "", args: [] },
      },
      system: "Be terse.",
      output: { syntax: "json", schema: { type: "string" } },
    };
    expect(JSON.parse(JSON.stringify(model))).toEqual(model);
    expectTypeOf(model.scope?.parent).toEqualTypeOf<InferenceModel["scope"]>();
  });
});

describe("redactDeep", () => {
  it("redacts every string in a nested value, leaving structure and non-strings intact", () => {
    const out = redactDeep({
      a: `key ${FAKE_KEY}`,
      n: 3,
      list: ["Bearer abcdefghij", { deep: "plain" }],
    });
    expect(out).toEqual({ a: "key [redacted]", n: 3, list: ["Bearer [redacted]", { deep: "plain" }] });
  });
});
