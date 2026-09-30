import { Codes } from "@nola-lang/ast";
import { resolveNolaConfig } from "@nola-lang/runtime";
import { describe, expect, it } from "vitest";

const ok = { text: "x" };

describe("model config: one shape — { name, infer(req) }", () => {
  it("accepts a { name, infer } model, bare and in a map", () => {
    const m = { name: "structured", infer: async () => ok };
    expect(resolveNolaConfig({ model: m }).model.default).toBe(m);
    const map = resolveNolaConfig({ model: { default: m, other: { name: "c", infer: async () => ok } } });
    expect(map.model.other?.name).toBe("c");
  });

  it("a complete()-only model is the retired chat dialect: NOLA3003 names the migration", () => {
    const chat = { name: "chat", complete: async () => ok };
    expect(() => resolveNolaConfig({ model: chat as never })).toThrow(/implements complete\(req\).*infer\(req\).*renderPrompt\(\)/);
    expect(() => resolveNolaConfig({ model: { default: { name: "x", infer: async () => ok }, legacy: chat } as never })).toThrow(
      /model\.legacy implements complete\(req\)/,
    );
    try {
      resolveNolaConfig({ model: chat as never });
    } catch (e) {
      expect((e as { code?: string }).code).toBe(Codes.ConfigInvalid);
    }
  });

  it("the not-a-model error names the one form", () => {
    expect(() => resolveNolaConfig({ model: { default: { name: "nope" } } as never })).toThrow(
      /model\.default is not a model \(need \{ name: string, infer\(req\) \}\)/,
    );
  });
});
