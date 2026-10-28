import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { projectFor, projectForDir, resetProjects, setConfigEvaluator } from "../src/project.js";

function tmpProject(config?: string): string {
  const dir = mkdtempSync(join(tmpdir(), "nola-bun-project-"));
  if (config !== undefined) writeFileSync(join(dir, "nola.config.ts"), config);
  return dir;
}

afterEach(() => {
  resetProjects();
  setConfigEvaluator(undefined);
});

describe("projectFor", () => {
  it("reads the compiler policy and the build target from the config, evaluated once per root", async () => {
    const dir = tmpProject('export default { model: {}, compiler: { underivableContextType: "prune" }, build: { target: "lib" } };\n');
    let evaluations = 0;
    setConfigEvaluator(async (path) => {
      evaluations++;
      expect(path).toBe(join(dir, "nola.config.ts"));
      return { model: {}, compiler: { underivableContextType: "prune" }, build: { target: "lib" } };
    });
    const ctx = await projectFor(join(dir, "src", "main.tsi"));
    expect(ctx.root).toBe(dir);
    expect(ctx.configPath).toBe(join(dir, "nola.config.ts"));
    expect(ctx.underivableContextType).toBe("prune");
    expect(ctx.target).toBe("lib");
    expect(ctx.wire).toBe(true);
    expect(ctx.config).toMatchObject({ compiler: { underivableContextType: "prune" } });
    const again = await projectForDir(dir);
    expect(again).toBe(ctx);
    expect(evaluations).toBe(1);
  });

  it("without a config: no config, no wiring, the default policy and target, the file's dir as root", async () => {
    const dir = tmpProject();
    const ctx = await projectFor(join(dir, "main.tsi"));
    expect(ctx.root).toBe(dir);
    expect(ctx.configPath).toBeNull();
    expect(ctx.config).toBeNull();
    expect(ctx.wire).toBe(false);
    expect(ctx.underivableContextType).toBe("error");
    expect(ctx.target).toBe("app");
  });

  it("config: false keeps reading the config (the preload needs it) but disables the wiring; target overrides", async () => {
    const dir = tmpProject("export default { model: {} };\n");
    setConfigEvaluator(async () => ({ model: {} }));
    const ctx = await projectFor(join(dir, "main.tsi"), { config: false, target: "lib" });
    expect(ctx.config).toEqual({ model: {} });
    expect(ctx.wire).toBe(false);
    expect(ctx.target).toBe("lib");
  });

  it("a config path override that does not exist is named in the error", async () => {
    const dir = tmpProject();
    await expect(projectFor(join(dir, "main.tsi"), { config: join(dir, "missing.config.ts") })).rejects.toThrow(
      /missing\.config\.ts.*not found/,
    );
  });

  it("a config module without a default export is refused with the fix", async () => {
    const dir = tmpProject("export const x = 1;\n");
    setConfigEvaluator(async () => undefined);
    await expect(projectFor(join(dir, "main.tsi"))).rejects.toThrow(/no default export/);
  });
});
