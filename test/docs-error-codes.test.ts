import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Codes } from "@nola-lang/ast";
import { describe, expect, it } from "vitest";

// The page must carry one `## NOLAxxxx` heading per diagnostic code. The heading
// text is the bare code so Starlight's slug is exactly `#nolaxxxx` — a URL
// contract other tooling links to; never add words to these headings.
const PAGE = fileURLToPath(new URL("../docs-site/reference/error-codes.mdx", import.meta.url));

const headings = readFileSync(PAGE, "utf8")
  .split("\n")
  .map((line) => /^## (NOLA\d{4})\s*$/.exec(line)?.[1])
  .filter((code): code is string => Boolean(code));

const codes = [...new Set(Object.values(Codes))].sort();

describe("error-codes reference page", () => {
  it("documents every diagnostic code, and no others", () => {
    expect([...headings].sort()).toEqual(codes);
  });

  it("documents each code exactly once", () => {
    expect(new Set(headings).size).toBe(headings.length);
  });
});
