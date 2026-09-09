import { describe, expect, it } from "vitest";
import { readValueFormat, VALUE_FORMAT_KEY, writeValueFormat } from "../src/value-format";

const memory = (seed: Record<string, string> = {}) => {
  const map = new Map(Object.entries(seed));
  return { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v), map };
};

describe("readValueFormat", () => {
  it("defaults to js when nothing or nonsense is stored", () => {
    expect(readValueFormat(memory())).toBe("js");
    expect(readValueFormat(memory({ [VALUE_FORMAT_KEY]: "yaml" }))).toBe("js");
    expect(
      readValueFormat({
        getItem: () => {
          throw new Error("private window");
        },
        setItem: () => {},
      }),
    ).toBe("js");
  });

  it("reads back what was written", () => {
    const storage = memory();
    writeValueFormat(storage, "js");
    expect(readValueFormat(storage)).toBe("js");
    writeValueFormat(storage, "json");
    expect(readValueFormat(storage)).toBe("json");
  });
});
