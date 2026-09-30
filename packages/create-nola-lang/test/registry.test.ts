import { describe, expect, it } from "vitest";
import { entryFile, exampleNames, featuredNames, TEMPLATES, templateByName, templateNames } from "../src/registry.js";

describe("template registry", () => {
  it("leads with the first menu — feature-extraction (the default), function-calling, agent-loop, typescript-interop, triage-ticket, empty — then the examples behind More examples…", () => {
    expect(templateNames().slice(0, 6)).toEqual([
      "feature-extraction",
      "function-calling",
      "agent-loop",
      "typescript-interop",
      "triage-ticket",
      "empty",
    ]);
    expect(featuredNames()).toEqual(templateNames().slice(0, 6));
    for (const t of TEMPLATES.slice(0, 6)) expect(t.source === "builtin" || t.featured === true, t.name).toBe(true);
    for (const t of TEMPLATES.slice(6)) {
      expect(t.source, t.name).toBe("example");
      expect(t.featured, t.name).toBeUndefined();
    }
    for (const gone of ["starter", "ts-import", "infer-function", "quick-script", "basic"]) {
      expect(templateByName(gone), gone).toBeUndefined();
    }
  });

  it("empty is the ONLY builtin template: every other template is an example, fetched from examples/", () => {
    expect(TEMPLATES.filter((t) => t.source === "builtin").map((t) => t.name)).toEqual(["empty"]);
    for (const name of ["feature-extraction", "function-calling", "agent-loop", "typescript-interop", "triage-ticket"]) {
      expect(templateByName(name)?.source, name).toBe("example");
      expect(templateByName(name)?.featured, name).toBe(true);
    }
  });

  it("the one-file templates and empty name their .tsi entry; the plain-TS examples run src/main.ts", () => {
    expect(entryFile("feature-extraction")).toBe("src/main.tsi");
    expect(entryFile("function-calling")).toBe("src/main.tsi");
    expect(entryFile("triage-ticket")).toBe("src/main.tsi");
    expect(entryFile("agent-loop")).toBe("src/main.tsi");
    expect(entryFile("typescript-interop")).toBe("src/main.ts");
    expect(entryFile("empty")).toBe("src/main.tsi");
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

  it("triage-ticket pins its vendor: the template's own config is TypeSafe, so the flow skips the provider question", () => {
    expect(templateByName("triage-ticket")?.provider).toEqual({ label: "typesafe.ai", envVar: "TYPESAFE_API_KEY" });
    for (const t of TEMPLATES) if (t.name !== "triage-ticket") expect(t.provider).toBeUndefined();
  });

  it("looks templates up by name", () => {
    expect(templateByName("empty")?.source).toBe("builtin");
    expect(templateByName("nope")).toBeUndefined();
  });
});
