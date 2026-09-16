import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDerivationService } from "@nola-lang/derive";
import { describe, expect, it } from "vitest";
import { RESOLVED_WIRING_ID } from "../src/core.js";
import { guardConfigGraphTsi, loadViewCode, resolveViewId, VIEW_PREFIX } from "../src/views.js";

function tmpDir(): string {
  return mkdtempSync(join(tmpdir(), "nola-views-"));
}

describe("resolveViewId", () => {
  it("maps a missing ./models.tsi next to the importer to the marked view of models.ts", () => {
    const dir = tmpDir();
    writeFileSync(join(dir, "models.ts"), "export interface Person { name: string }\n");
    expect(resolveViewId("./models.tsi", join(dir, "report.tsi"))).toBe(`${VIEW_PREFIX}${join(dir, "models.ts")}`);
  });

  it("returns null for a real .tsi (the bundler serves it) and for non-.tsi specifiers", () => {
    const dir = tmpDir();
    writeFileSync(join(dir, "shapes.tsi"), "export type S = { k: string };\n");
    expect(resolveViewId("./shapes.tsi", join(dir, "report.tsi"))).toBeNull();
    expect(resolveViewId("./models.js", "/x/report.tsi")).toBeNull();
    expect(resolveViewId("@nola-lang/runtime", "/x/report.tsi")).toBeNull();
  });

  it("nothing on disk is NOLA2007", () => {
    expect(() => resolveViewId("./missing.tsi", join(tmpDir(), "report.tsi"))).toThrow(/NOLA2007/);
  });
});

describe("loadViewCode", () => {
  it("compiles the view with an ABSOLUTE re-export target and reports the watch file", async () => {
    const dir = tmpDir();
    const src = join(dir, "models.ts");
    writeFileSync(src, "export interface Person { name: string }\nexport const tag = 1;\n");
    const service = createDerivationService({ projectRoot: dir, sourceRoot: dir, underivableContextType: "error" });
    const out = await loadViewCode(`${VIEW_PREFIX}${src}`, service);
    service.dispose();
    expect(out.code).toContain(`export * from ${JSON.stringify(src.replace(/\\/g, "/"))}`);
    // esbuild folds the value export into an export list (the name is also a type export)
    expect(out.code).toMatch(/const Person = __nola_type_Person\(\)/);
    expect(out.code).toMatch(/export (const Person|\{\s*Person\s*\})/);
    expect(out.code).not.toContain("interface");
    expect(out.watchFiles).toContain(src);
    // the checker derived the body — emit 15 — so the value is a real carrier expression
    expect(out.code).toContain("__nola.types.object({ name: __nola.types.string() })");
  });
});

describe("guardConfigGraphTsi", () => {
  it("refuses .tsi imported by nola.config.ts or the wiring module", () => {
    expect(() => guardConfigGraphTsi("./x.tsi", "/proj/nola.config.ts")).toThrow(/NOLA3012/);
    expect(() => guardConfigGraphTsi("./x.tsi", RESOLVED_WIRING_ID)).toThrow(/NOLA3012/);
  });

  it("allows .tsi elsewhere and non-.tsi anywhere", () => {
    expect(() => guardConfigGraphTsi("./x.tsi", "/proj/src/main.ts")).not.toThrow();
    expect(() => guardConfigGraphTsi("./x.ts", "/proj/nola.config.ts")).not.toThrow();
    expect(() => guardConfigGraphTsi("./x.tsi", undefined)).not.toThrow();
  });
});
