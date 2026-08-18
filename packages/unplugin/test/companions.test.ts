import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { COMPANION_PREFIX, guardConfigGraphTsi, loadCompanionCode, resolveCompanionId } from "../src/companions.js";
import { RESOLVED_WIRING_ID } from "../src/core.js";

function tmpDir(): string {
  return mkdtempSync(join(tmpdir(), "nola-companions-"));
}

describe("resolveCompanionId", () => {
  it("maps ./models.nola.js next to a .tsi importer to the marked type source", () => {
    const dir = tmpDir();
    writeFileSync(join(dir, "models.ts"), "export interface Person { name: string }\n");
    const id = resolveCompanionId("./models.nola.js", join(dir, "report.tsi"));
    expect(id).toBe(`${COMPANION_PREFIX}${join(dir, "models.ts")}`);
  });

  it("returns null for non-companion specifiers", () => {
    expect(resolveCompanionId("./models.js", "/x/report.tsi")).toBeNull();
    expect(resolveCompanionId("@nola-lang/runtime", "/x/report.tsi")).toBeNull();
  });

  it("a real on-disk *.nola.* file is NOLA2006", () => {
    const dir = tmpDir();
    writeFileSync(join(dir, "models.nola.js"), "// squatter\n");
    expect(() => resolveCompanionId("./models.nola.js", join(dir, "report.tsi"))).toThrow(/NOLA2006/);
  });

  it("an unlocatable type source is NOLA2007", () => {
    const dir = tmpDir();
    expect(() => resolveCompanionId("./missing.nola.js", join(dir, "report.tsi"))).toThrow(/NOLA2007/);
  });
});

describe("loadCompanionCode", () => {
  it("compiles the companion to JS and reports the watch file", async () => {
    const dir = tmpDir();
    const src = join(dir, "models.ts");
    writeFileSync(src, "export interface Person { name: string }\n");
    const out = await loadCompanionCode(`${COMPANION_PREFIX}${src}`, dir);
    expect(out.code).toContain("__nola_type_Person");
    expect(out.code).not.toContain("interface"); // stripped
    expect(out.watchFile).toBe(src);
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
