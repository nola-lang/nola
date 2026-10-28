import { describe, expect, it } from "vitest";
import { assertBunVersion, guardBrowserTarget, guardConfigGraphTsi } from "../src/guards.js";
import { wiringIdFor } from "../src/wiring.js";

describe("assertBunVersion (NOLA3023)", () => {
  it("never raises under Node — there is nothing to assert", () => {
    expect(() => assertBunVersion({ node: "22.21.1" }, true)).not.toThrow();
    expect(() => assertBunVersion({ node: "22.21.1" }, false)).not.toThrow();
  });

  it("passes a Bun that has process.getBuiltinModule", () => {
    expect(() => assertBunVersion({ bun: "1.3.14" }, true)).not.toThrow();
  });

  it("refuses a Bun without it, naming the floor and the version", () => {
    expect(() => assertBunVersion({ bun: "1.2.0" }, false)).toThrow(/NOLA3023.*Bun >= 1\.3\.0.*Bun 1\.2\.0/);
  });
});

describe("guardBrowserTarget (NOLA4001)", () => {
  it("refuses a browser target", () => {
    expect(() => guardBrowserTarget({ target: "browser" })).toThrow(/NOLA4001/);
  });

  it("lets bun and node targets, and runtime mode (no config), through", () => {
    expect(() => guardBrowserTarget({ target: "bun" })).not.toThrow();
    expect(() => guardBrowserTarget({ target: "node" })).not.toThrow();
    expect(() => guardBrowserTarget(undefined)).not.toThrow();
  });
});

describe("guardConfigGraphTsi (NOLA3012)", () => {
  it("refuses a .tsi imported by nola.config.ts or by the wiring module", () => {
    expect(() => guardConfigGraphTsi("./src/shapes.tsi", "/app/nola.config.ts")).toThrow(/NOLA3012/);
    expect(() => guardConfigGraphTsi("./shapes.tsi", wiringIdFor("/app/nola.config.ts"))).toThrow(/NOLA3012/);
  });

  it("ignores other importers, non-.tsi specifiers, and an absent importer", () => {
    expect(() => guardConfigGraphTsi("./src/shapes.tsi", "/app/src/main.tsi")).not.toThrow();
    expect(() => guardConfigGraphTsi("./models.js", "/app/nola.config.ts")).not.toThrow();
    expect(() => guardConfigGraphTsi("./src/shapes.tsi", undefined)).not.toThrow();
  });
});
