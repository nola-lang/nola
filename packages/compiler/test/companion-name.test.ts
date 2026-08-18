import {
  companionSourceCandidates,
  companionSpecifierFor,
  isCompanionSpecifier,
  isReservedNolaName,
  moduleIdFor,
} from "@nola-lang/compiler";
import { describe, expect, it } from "vitest";

describe("companion naming", () => {
  it("forward transform strips .js/.ts, keeps .tsi and .d.ts whole", () => {
    expect(companionSpecifierFor("./models.js")).toBe("./models.nola.js");
    expect(companionSpecifierFor("./models.ts")).toBe("./models.nola.js");
    expect(companionSpecifierFor("./shapes.tsi")).toBe("./shapes.tsi.nola.js");
    expect(companionSpecifierFor("./api.d.ts")).toBe("./api.d.ts.nola.js");
  });

  it("reverse candidates probe .ts, .tsi, .js — or the exact kept extension", () => {
    expect(companionSourceCandidates("./models.nola.js")).toEqual(["./models.ts", "./models.tsi", "./models.js"]);
    expect(companionSourceCandidates("./shapes.tsi.nola.js")).toEqual(["./shapes.tsi"]);
    expect(companionSourceCandidates("./api.d.ts.nola.js")).toEqual(["./api.d.ts"]);
  });

  it("round-trips: forward then reverse finds the origin", () => {
    for (const origin of ["./models.ts", "./x/deep.js", "./shapes.tsi"]) {
      expect(companionSourceCandidates(companionSpecifierFor(origin))).toContain(origin);
    }
  });

  it("moduleIdFor joins against the importer's display dir and strips extensions", () => {
    expect(moduleIdFor("src/report.tsi", "./models.js")).toBe("src/models");
    expect(moduleIdFor("src/a/b.tsi", "../geo.ts")).toBe("src/geo");
    expect(moduleIdFor("src/a.tsi", "./shapes.tsi")).toBe("src/shapes");
  });

  it("reserved-name predicate", () => {
    expect(isReservedNolaName("models.nola.js")).toBe(true);
    expect(isReservedNolaName("x.nola.anything.ts")).toBe(true);
    expect(isReservedNolaName("granola.ts")).toBe(false);
    expect(isCompanionSpecifier("./m.nola.js")).toBe(true);
  });
});
