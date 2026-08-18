import { describe, expect, it } from "vitest";
import { TEMPLATES, templateByName, templateNames } from "../src/registry.js";

describe("template registry", () => {
  it("leads with starter (the default) and empty, then examples", () => {
    expect(templateNames().slice(0, 2)).toEqual(["starter", "empty"]);
    expect(TEMPLATES[0]?.source).toBe("builtin");
    expect(TEMPLATES[1]?.source).toBe("builtin");
  });

  it("offers the five curated examples, never extract-person (the starter IS extract-person)", () => {
    const examples = TEMPLATES.filter((t) => t.source === "example").map((t) => t.name);
    expect(examples).toEqual(["extract-resume", "extract-invoice", "classify-message", "chain-of-thought", "research-notes"]);
    expect(templateByName("extract-person")).toBeUndefined();
  });

  it("looks templates up by name", () => {
    expect(templateByName("empty")?.source).toBe("builtin");
    expect(templateByName("nope")).toBeUndefined();
  });
});
