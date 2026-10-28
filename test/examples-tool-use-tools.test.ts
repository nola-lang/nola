import { describe, expect, it } from "vitest";
import { readFile, searchFiles } from "../examples/tool-use/src/tools.js";

// The example's tools meet real models, not only the recorded ledger: a model
// writes glob patterns (`*visa*` — gpt-oss-120b on Cerebras, 2026-10-09) where
// the JSDoc says "contains", and a substring match answered [] nine turns in
// a row until the model gave up with an empty answer. The JSDoc stays as it
// is: the tool's description is part of the ask's fingerprint, so a wording
// change would re-key the committed ledger.
describe("examples/tool-use tools", () => {
  it("searchFiles takes the pattern as a substring or as a glob, case-insensitively", async () => {
    const visa = ["D:/docs/visa/ds-160-confirmation.pdf", "D:/docs/visa/passport-scan.pdf"];
    expect(await searchFiles("D:/docs", "visa")).toEqual(visa); // the ledger's recorded call
    expect(await searchFiles("D:/", "*visa*")).toEqual(visa);
    expect(await searchFiles("D:/", "*DS-160*.*")).toEqual([visa[0]]);
    expect(await searchFiles("D:/", "*")).toHaveLength(4);
    expect(await searchFiles("D:/docs")).toHaveLength(3);
    expect(await searchFiles("D:/photos", "visa")).toEqual([]);
  });

  it("readFile reads a known path and throws on an unknown one", async () => {
    expect(await readFile("D:/photos/cat.jpg")).toBe("(binary)");
    await expect(readFile("D:/nope")).rejects.toThrow(/no such file/);
  });
});
