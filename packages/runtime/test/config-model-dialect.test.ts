import { Codes } from "@nola-lang/ast";
import { resolveNolaConfig } from "@nola-lang/runtime";
import { describe, expect, it } from "vitest";

const ok = { text: "x" };

describe("model config: the method name is the dialect", () => {
  it("accepts a { name, infer } model, bare and in a map", () => {
    const m = { name: "structured", infer: async () => ok };
    expect(resolveNolaConfig({ model: m }).model.default).toBe(m);
    const map = resolveNolaConfig({ model: { default: m, other: { name: "c", complete: async () => ok } } });
    expect(map.model.other?.name).toBe("c");
  });

  it("rejects a model carrying both methods, naming the rule", () => {
    const both = { name: "both", infer: async () => ok, complete: async () => ok };
    expect(() => resolveNolaConfig({ model: both })).toThrow(/one of complete\(req\) or infer\(req\), not both/);
    try {
      resolveNolaConfig({ model: both });
    } catch (e) {
      expect((e as { code?: string }).code).toBe(Codes.ConfigInvalid);
    }
  });

  it("the not-a-model error names both forms", () => {
    expect(() => resolveNolaConfig({ model: { default: { name: "nope" } } as never })).toThrow(
      /model\.default is not a model \(need \{ name: string, complete\(req\) \} or \{ name: string, infer\(req\) \}\)/,
    );
  });
});
