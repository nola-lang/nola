import {
  isTsiSpecifier,
  moduleIdFor,
  posixDirname,
  posixJoin,
  posixRelative,
  viewSourceCandidates,
  viewSourceSpecifierFor,
  viewSpecifierFor,
} from "@nola-lang/compiler";
import { describe, expect, it } from "vitest";

describe("the *.tsi rule", () => {
  it("viewSpecifierFor maps every type-source specifier to its .tsi twin", () => {
    expect(viewSpecifierFor("./models.js")).toBe("./models.tsi");
    expect(viewSpecifierFor("./models.ts")).toBe("./models.tsi");
    expect(viewSpecifierFor("../geo/api.d.ts")).toBe("../geo/api.tsi");
    expect(viewSpecifierFor("./shapes.tsi")).toBe("./shapes.tsi");
  });

  it("viewSourceCandidates probes .ts then .d.ts next to the .tsi path", () => {
    expect(viewSourceCandidates("./models.tsi")).toEqual(["./models.ts", "./models.d.ts"]);
    expect(viewSourceCandidates("/proj/src/models.tsi")).toEqual(["/proj/src/models.ts", "/proj/src/models.d.ts"]);
  });

  it("viewSourceSpecifierFor is the NodeNext specifier a view uses for export *", () => {
    expect(viewSourceSpecifierFor("/proj/src/models.ts")).toBe("./models.js");
    expect(viewSourceSpecifierFor("C:\\p\\api.d.ts")).toBe("./api.js");
  });

  it("isTsiSpecifier accepts only relative .tsi specifiers", () => {
    expect(isTsiSpecifier("./a.tsi")).toBe(true);
    expect(isTsiSpecifier("../a.tsi")).toBe(true);
    expect(isTsiSpecifier("pkg/a.tsi")).toBe(false);
    expect(isTsiSpecifier("./a.ts")).toBe(false);
  });

  it("moduleIdFor strips .tsi too", () => {
    expect(moduleIdFor("src/report.tsi", "./models.tsi")).toBe("src/models");
  });

  it("posix path arithmetic (no node:path in this package)", () => {
    expect(posixDirname("/proj/src/models.ts")).toBe("/proj/src");
    expect(posixDirname("C:\\p\\models.ts")).toBe("C:/p");
    expect(posixDirname("models.ts")).toBe(".");
    expect(posixJoin("/proj/src", "../lib/shapes.tsi")).toBe("/proj/lib/shapes.tsi");
    expect(posixJoin("D:/p/src", "./geo.tsi")).toBe("D:/p/src/geo.tsi");
    expect(posixRelative("/proj/src", "/proj/lib/shapes.tsi")).toBe("../lib/shapes.tsi");
    expect(posixRelative("/proj/src", "/proj/src/shapes.tsi")).toBe("./shapes.tsi");
    expect(posixRelative("D:/p/src", "D:/p/src/deep/x.tsi")).toBe("./deep/x.tsi");
  });
});
