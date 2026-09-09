import { describe, expect, it } from "vitest";
import { readSplitLayout, SPLIT_LAYOUT_KEY, writeSplitLayout } from "../src/split-layout";

function memory(initial: Record<string, string> = {}): Pick<Storage, "getItem" | "setItem"> {
  const map = new Map(Object.entries(initial));
  return { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v) };
}

describe("split layout persistence", () => {
  it("round-trips a layout", () => {
    const storage = memory();
    writeSplitLayout(storage, { master: 30, detail: 70 });
    expect(readSplitLayout(storage)).toEqual({ master: 30, detail: 70 });
  });

  it("returns undefined when nothing is stored, the JSON is broken, or the shape is wrong", () => {
    expect(readSplitLayout(memory())).toBeUndefined();
    expect(readSplitLayout(memory({ [SPLIT_LAYOUT_KEY]: "{nope" }))).toBeUndefined();
    expect(readSplitLayout(memory({ [SPLIT_LAYOUT_KEY]: '{"master":"30"}' }))).toBeUndefined();
    expect(readSplitLayout(memory({ [SPLIT_LAYOUT_KEY]: "[1,2]" }))).toBeUndefined();
  });

  it("swallows a storage that throws", () => {
    const throwing = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(readSplitLayout(throwing)).toBeUndefined();
    expect(() => writeSplitLayout(throwing, { master: 30, detail: 70 })).not.toThrow();
  });
});
