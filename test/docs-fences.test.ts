import { describe, expect, it } from "vitest";
// @ts-expect-error - plain ESM helper, no type declarations
import { extractFences, pageSlug, planPageFiles } from "../scripts/lib/tsi-fences.mjs";

const TICKS = "```";
const fence = (lang: string, body: string) => `${TICKS}${lang}\n${body}\n${TICKS}`;

describe("extractFences", () => {
  it("returns the language, body and opening line of each fence", () => {
    const md = ["intro", fence("tsi", "const a = 1;"), "between", fence("sh", "npm test")].join("\n");
    expect(extractFences(md)).toEqual([
      { lang: "tsi", body: "const a = 1;", line: 2 },
      { lang: "sh", body: "npm test", line: 6 },
    ]);
  });
});

describe("planPageFiles", () => {
  it("names a fence from its leading file comment and strips that comment", () => {
    const { files, errors } = planPageFiles(extractFences(fence("tsi", "// person.tsi\nconst a = 1;")));
    expect(errors).toEqual([]);
    expect(files).toEqual([{ name: "person.tsi", body: "const a = 1;", fenceLine: 1 }]);
  });

  it("gives an unnamed tsi fence a positional name and keeps the whole body", () => {
    const { files } = planPageFiles(extractFences(fence("tsi", "const a = 1;")));
    expect(files).toEqual([{ name: "snippet-1.tsi", body: "const a = 1;", fenceLine: 1 }]);
  });

  it("skips a fence marked not-checked", () => {
    expect(planPageFiles(extractFences(fence("tsi", "// not-checked\nthis is not valid"))).files).toEqual([]);
  });

  it("skips unnamed plain-ts fences and nola.config samples", () => {
    const md = [fence("ts", "const a = 1;"), fence("ts", "// nola.config.ts\nexport default {};")].join("\n");
    expect(planPageFiles(extractFences(md)).files).toEqual([]);
  });

  it("reports a duplicate sample file name", () => {
    const md = [fence("tsi", "// a.tsi\nconst a = 1;"), fence("tsi", "// a.tsi\nconst b = 2;")].join("\n");
    const { files, errors } = planPageFiles(extractFences(md));
    expect(files).toHaveLength(1);
    expect(errors[0]).toContain('duplicate sample file "a.tsi"');
  });
});

describe("pageSlug", () => {
  it("flattens a page path into a directory name", () => {
    expect(pageSlug("language/ask.mdx")).toBe("language-ask");
  });
});
