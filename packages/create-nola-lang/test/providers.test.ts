import { describe, expect, it } from "vitest";
import { PROVIDERS, providerById, providerIds } from "../src/providers.js";

describe("inference provider menu", () => {
  it("leads with nola, then the four vendors, then none", () => {
    expect(providerIds()).toEqual(["nola", "openai", "anthropic", "google", "typesafe", "none"]);
  });

  it("names the env var each vendor reads, and none for nola/none", () => {
    expect(providerById("openai")?.envVar).toBe("OPENAI_API_KEY");
    expect(providerById("anthropic")?.envVar).toBe("ANTHROPIC_API_KEY");
    expect(providerById("google")?.envVar).toBe("GEMINI_API_KEY");
    expect(providerById("typesafe")?.envVar).toBe("TYPESAFE_API_KEY");
    expect(providerById("nola")?.envVar).toBeUndefined();
    expect(providerById("none")?.envVar).toBeUndefined();
  });

  it("labels Gemini under the google id (the factory is google())", () => {
    expect(providerById("google")?.label).toBe("Gemini");
    expect(providerById("nope")).toBeUndefined();
  });

  it("every live provider is a menu option with a label and a hint", () => {
    for (const p of PROVIDERS) {
      expect(p.label.length).toBeGreaterThan(0);
      expect(p.hint.length).toBeGreaterThan(0);
    }
  });
});
