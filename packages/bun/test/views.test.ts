import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { projectFor, resetProjects } from "../src/project.js";
import { loadView, resolveView, VIEW_NAMESPACE } from "../src/views.js";

const tmpDir = () => mkdtempSync(join(tmpdir(), "nola-bun-views-"));

afterEach(() => resetProjects());

describe("resolveView", () => {
  it("maps a missing ./models.tsi beside the importer to its plain source in the nola-view namespace", () => {
    const dir = tmpDir();
    writeFileSync(join(dir, "models.ts"), "export interface Person { name: string }\n");
    expect(VIEW_NAMESPACE).toBe("nola-view");
    expect(resolveView("./models.tsi", join(dir, "report.tsi"))).toEqual({ path: join(dir, "models.ts"), namespace: VIEW_NAMESPACE });
  });

  it("prefers x.ts over x.d.ts and falls back to x.d.ts", () => {
    const dir = tmpDir();
    writeFileSync(join(dir, "shapes.d.ts"), "export interface S { k: string }\n");
    expect(resolveView("./shapes.tsi", join(dir, "report.tsi"))?.path).toBe(join(dir, "shapes.d.ts"));
    writeFileSync(join(dir, "shapes.ts"), "export interface S { k: string }\n");
    expect(resolveView("./shapes.tsi", join(dir, "report.tsi"))?.path).toBe(join(dir, "shapes.ts"));
  });

  it("returns nothing for a real .tsi (Bun resolves it) and for non-.tsi specifiers", () => {
    const dir = tmpDir();
    writeFileSync(join(dir, "shapes.tsi"), "export type S = { k: string };\n");
    expect(resolveView("./shapes.tsi", join(dir, "report.tsi"))).toBeUndefined();
    expect(resolveView("./models.js", join(dir, "report.tsi"))).toBeUndefined();
    expect(resolveView("@nola-lang/runtime", join(dir, "report.tsi"))).toBeUndefined();
  });

  it("nothing on disk is NOLA2007", () => {
    expect(() => resolveView("./missing.tsi", join(tmpDir(), "report.tsi"))).toThrow(/NOLA2007/);
  });
});

describe("loadView", () => {
  it("serves the view's TypeScript: the re-export by absolute path (no resolve dir needed), the type, and the value", async () => {
    const dir = tmpDir();
    writeFileSync(join(dir, "models.ts"), "export interface Person { name: string; age: number }\n");
    const ctx = await projectFor(join(dir, "report.tsi"));
    const code = loadView(join(dir, "models.ts"), ctx);
    expect(code).toContain(`export * from "${join(dir, "models.ts").replaceAll("\\", "/")}"`);
    expect(code).toContain("Person");
    expect(code).toContain("__nola.types");
  });
});
