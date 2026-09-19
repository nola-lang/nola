import { describe, expect, it } from "vitest";
import { entryFile, exampleNames, featuredNames, TEMPLATES, templateByName, templateNames } from "../src/registry.js";

describe("template registry", () => {
  it("leads with the first-menu templates by feature — feature-extraction (the default), function-calling, typescript-interop, triage-ticket, empty — then the examples", () => {
    expect(templateNames().slice(0, 5)).toEqual([
      "feature-extraction",
      "function-calling",
      "typescript-interop",
      "triage-ticket",
      "empty",
    ]);
    expect(featuredNames()).toEqual(templateNames().slice(0, 5));
    for (const t of TEMPLATES.slice(0, 5)) expect(t.source === "builtin" || t.featured === true).toBe(true);
    for (const t of TEMPLATES.slice(5)) expect(t.source).toBe("example");
    for (const gone of ["starter", "ts-import", "infer-function", "quick-script", "basic"]) {
      expect(templateByName(gone), gone).toBeUndefined();
    }
  });

  it("the one-file templates name their .tsi entry; everything else runs plain src/main.ts", () => {
    expect(entryFile("feature-extraction")).toBe("src/main.tsi");
    expect(entryFile("function-calling")).toBe("src/main.tsi");
    expect(entryFile("triage-ticket")).toBe("src/main.tsi");
    expect(entryFile("typescript-interop")).toBe("src/main.ts");
    expect(entryFile("empty")).toBe("src/main.ts");
    expect(entryFile("extract-resume")).toBe("src/main.ts");
    expect(entryFile(undefined)).toBe("src/main.ts");
  });

  it("offers six curated examples behind More examples…, file-ticket (call intents) first, never extract-person (typescript-interop IS extract-person)", () => {
    expect(exampleNames()).toEqual([
      "file-ticket",
      "extract-resume",
      "extract-invoice",
      "classify-message",
      "chain-of-thought",
      "research-notes",
    ]);
    expect(templateByName("extract-person")).toBeUndefined();
  });

  it("triage-ticket is the featured example: fetched from examples/ like the others, listed on the first menu, one .tsi file", () => {
    const t = templateByName("triage-ticket");
    expect(t?.source).toBe("example");
    expect(t?.featured).toBe(true);
    expect(t?.entry).toBe("src/main.tsi");
    for (const other of TEMPLATES) if (other.name !== "triage-ticket") expect(other.featured).toBeUndefined();
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
