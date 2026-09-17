import { describe, expect, it } from "vitest";
import { barColor, PROVIDER_SLOTS, providerColors } from "../src/provider-colors";

describe("providerColors", () => {
  it("gives every provider its own slot while slots last", () => {
    const providers = ["anthropic:claude", "mock", "nola", "openai:gpt-5", "google:gemini"];
    const colors = providerColors(providers);
    expect(new Set(providers.map((p) => colors.get(p))).size).toBe(PROVIDER_SLOTS);
    for (const p of providers) expect(colors.get(p)).toMatch(/^var\(--provider-[1-5]\)$/);
  });

  it("colour follows the provider, not its position: company does not repaint it", () => {
    const alone = providerColors(["anthropic:claude"]).get("anthropic:claude");
    expect(providerColors(["mock", "anthropic:claude", "nola"]).get("anthropic:claude")).toBe(alone);
  });

  it("a slot collision moves one provider — the same one whatever the input order", () => {
    // these two hash to the same slot
    expect(providerColors(["mock"]).get("mock")).toBe(providerColors(["openai:gpt-5"]).get("openai:gpt-5"));
    const ab = providerColors(["mock", "openai:gpt-5"]);
    const ba = providerColors(["openai:gpt-5", "mock"]);
    expect(ab.get("mock")).not.toBe(ab.get("openai:gpt-5"));
    expect([...ab]).toEqual([...ba]);
    expect(ab.get("mock")).toBe(providerColors(["mock"]).get("mock")); // first by name keeps its slot
  });

  it("rotates once there are more providers than slots", () => {
    const providers = Array.from({ length: 8 }, (_, i) => `p${i}`);
    const colors = providerColors(providers);
    expect(colors.size).toBe(8);
    expect(new Set(colors.values()).size).toBe(PROVIDER_SLOTS);
  });
});

describe("barColor", () => {
  const colors = providerColors(["mock"]);

  it("status wins: a failed or running execution keeps its reserved colour", () => {
    expect(barColor({ status: "error", provider: "mock" }, colors)).toBe("var(--err)");
    expect(barColor({ status: "running", provider: "mock" }, colors)).toBe("var(--live)");
  });

  it("an ok execution wears its provider's colour; an unknown provider is neutral", () => {
    expect(barColor({ status: "ok", provider: "mock" }, colors)).toBe(colors.get("mock"));
    expect(barColor({ status: "ok" }, colors)).toBe("var(--chart-4)");
    expect(barColor({ status: "ok", provider: "never-listed" }, colors)).toBe("var(--chart-4)");
  });
});
