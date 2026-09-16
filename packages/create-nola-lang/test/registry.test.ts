import { describe, expect, it } from "vitest";
import { TEMPLATES, templateByName, templateNames } from "../src/registry.js";

describe("template registry", () => {
  it("leads with starter (the default) and empty, then examples", () => {
    expect(templateNames().slice(0, 2)).toEqual(["starter", "empty"]);
    expect(TEMPLATES[0]?.source).toBe("builtin");
    expect(TEMPLATES[1]?.source).toBe("builtin");
  });

  it("offers the seven curated examples, file-ticket (call intents) first, never extract-person (the starter IS extract-person)", () => {
    const examples = TEMPLATES.filter((t) => t.source === "example").map((t) => t.name);
    expect(examples).toEqual([
      "file-ticket",
      "extract-resume",
      "extract-invoice",
      "classify-message",
      "chain-of-thought",
      "research-notes",
      "triage-ticket",
    ]);
    expect(templateByName("extract-person")).toBeUndefined();
  });

  it("triage-ticket pins its vendor: the template's own config is TypeSafe, so the flow skips the provider question", () => {
    expect(templateByName("triage-ticket")?.provider).toEqual({ label: "typesafe.ai", envVar: "TYPESAFE_API_KEY" });
    for (const t of TEMPLATES) if (t.name !== "triage-ticket") expect(t.provider).toBeUndefined();
  });

  it("looks templates up by name", () => {
    expect(templateByName("empty")?.source).toBe("builtin");
    expect(templateByName("nope")).toBeUndefined();
  });
});
