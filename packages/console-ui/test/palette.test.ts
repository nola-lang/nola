import { describe, expect, it } from "vitest";
import { matchSegments } from "../src/palette";

describe("matchSegments", () => {
  it("returns the whole label unhit for an empty query", () => {
    expect(matchSegments("time range", "")).toEqual([{ text: "time range", hit: false }]);
    expect(matchSegments("time range", "   ")).toEqual([{ text: "time range", hit: false }]);
  });

  it("marks the query's characters in order, case-insensitively", () => {
    expect(matchSegments("Duration", "dur")).toEqual([
      { text: "Dur", hit: true },
      { text: "ation", hit: false },
    ]);
    expect(matchSegments("time range", "tr")).toEqual([
      { text: "t", hit: true },
      { text: "ime ", hit: false },
      { text: "r", hit: true },
      { text: "ange", hit: false },
    ]);
  });

  it("prefers a word-start over an earlier mid-word character", () => {
    expect(matchSegments("path of file", "fi")).toEqual([
      { text: "path of ", hit: false },
      { text: "fi", hit: true },
      { text: "le", hit: false },
    ]);
  });

  it("leaves the label unhit when the query is not a subsequence", () => {
    expect(matchSegments("pid", "xyz")).toEqual([{ text: "pid", hit: false }]);
  });

  it("ignores spaces in the query", () => {
    expect(matchSegments("time range", "t r")).toEqual([
      { text: "t", hit: true },
      { text: "ime ", hit: false },
      { text: "r", hit: true },
      { text: "ange", hit: false },
    ]);
  });
});
