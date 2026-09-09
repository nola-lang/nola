import { describe, expect, it } from "vitest";
import { withSearch } from "../src/search";

describe("withSearch", () => {
  it("sets, deletes, and preserves unrelated params", () => {
    const sp = new URLSearchParams("run=abc&ask=1");
    expect(withSearch(sp, { ask: "2" })).toBe("?run=abc&ask=2");
    expect(withSearch(sp, { ask: undefined })).toBe("?run=abc");
    expect(withSearch(sp, { ask: undefined, run: undefined })).toBe("");
    expect(sp.toString()).toBe("run=abc&ask=1");
  });
});
