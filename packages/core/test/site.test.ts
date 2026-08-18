import { Site } from "@nola-lang/core";
import { describe, expect, it } from "vitest";

describe("Site", () => {
  it("holds file and loc and renders as file:line:col", () => {
    const s = new Site("src/app.tsi", "3:7");
    expect(s.file).toBe("src/app.tsi");
    expect(s.loc).toBe("3:7");
    expect(`at ${s}`).toBe("at src/app.tsi:3:7");
  });

  it("parse is the inverse of toString", () => {
    expect(Site.parse("src/app.tsi:3:7")).toEqual(new Site("src/app.tsi", "3:7"));
  });

  it("parse anchors from the right — colons in the path stay in file", () => {
    expect(Site.parse("weird:name.tsi:12:1")).toEqual(new Site("weird:name.tsi", "12:1"));
  });

  it('parse accepts the unknown-site loc "?"', () => {
    expect(Site.parse("src/app.tsi:?")).toEqual(new Site("src/app.tsi", "?"));
    expect(String(new Site("src/app.tsi", "?"))).toBe("src/app.tsi:?");
  });

  it("parse throws on text that is not a source location", () => {
    expect(() => Site.parse("no-location-here")).toThrow(/not a source location/);
  });

  it("instances are frozen", () => {
    const s = new Site("x.tsi", "1:1");
    expect(Object.isFrozen(s)).toBe(true);
    expect(() => {
      (s as { file: string }).file = "y.tsi";
    }).toThrow(TypeError);
  });

  it("JSON-serializes as { file, loc }", () => {
    expect(JSON.parse(JSON.stringify(new Site("x.tsi", "1:1")))).toEqual({ file: "x.tsi", loc: "1:1" });
  });
});
