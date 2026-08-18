import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { configPathFromWiringId, transformTsi, WIRING_ID, wiringIdFor, wiringSource } from "../src/core.js";
import { projectFor } from "../src/project.js";

const TSI = "infer function greet(.name: string) {\n  return ask ..`say hello to the user`<string>;\n}\n";

function tmpProject(withConfig: boolean): string {
  const dir = mkdtempSync(join(tmpdir(), "nola-unplugin-"));
  if (withConfig) {
    // compiler/build sections only are read; runtime validity not required
    writeFileSync(join(dir, "nola.config.ts"), "export default { providers: {} };\n");
  }
  writeFileSync(join(dir, "greet.tsi"), TSI);
  return dir;
}

describe("projectFor", () => {
  it("resolves root, target app, and the config path", async () => {
    const dir = tmpProject(true);
    const ctx = await projectFor(join(dir, "greet.tsi"), {});
    expect(ctx.sourceRoot).toBe(dir);
    expect(ctx.target).toBe("app");
    expect(ctx.configPath).toBe(join(dir, "nola.config.ts"));
  });

  it("config:false disables wiring; target override wins", async () => {
    const dir = tmpProject(true);
    const ctx = await projectFor(join(dir, "greet.tsi"), { config: false, target: "lib" });
    expect(ctx.configPath).toBeNull();
    expect(ctx.target).toBe("lib");
  });
});

describe("transformTsi", () => {
  it("emits JS (types stripped) with a merged map", async () => {
    const dir = tmpProject(false);
    const ctx = await projectFor(join(dir, "greet.tsi"), {});
    const out = await transformTsi(TSI, join(dir, "greet.tsi"), ctx);
    expect(out.code).toContain("__nola.useRuntime");
    expect(out.code).not.toContain(": string"); // stripped
    expect(JSON.parse(out.map).version).toBe(3);
  });

  it("app target with config appends exactly one wiring import at EOF", async () => {
    const dir = tmpProject(true);
    const ctx = await projectFor(join(dir, "greet.tsi"), {});
    const out = await transformTsi(TSI, join(dir, "greet.tsi"), ctx);
    const wiringId = wiringIdFor(join(dir, "nola.config.ts"));
    const hits = out.code.split(JSON.stringify(wiringId)).length - 1;
    expect(hits).toBe(1);
    expect(out.code.trimEnd().endsWith(`import ${JSON.stringify(wiringId)};`)).toBe(true);
  });

  it("lib target and config-less projects get no wiring import", async () => {
    const dir = tmpProject(false);
    const ctx = await projectFor(join(dir, "greet.tsi"), {});
    const out = await transformTsi(TSI, join(dir, "greet.tsi"), ctx);
    expect(out.code).not.toContain(WIRING_ID);
  });
});

describe("wiring id + source", () => {
  it("round-trips the config path through the query param", () => {
    const id = wiringIdFor("D:\\proj\\nola.config.ts");
    expect(id.startsWith(WIRING_ID)).toBe(true);
    expect(configPathFromWiringId(id)).toBe("D:\\proj\\nola.config.ts");
  });

  it("wiringSource imports the config with forward slashes and configures the runtime", () => {
    const src = wiringSource("D:\\proj\\nola.config.ts");
    expect(src).toContain('import config from "D:/proj/nola.config.ts";');
    expect(src).toContain('import { nolaRuntime } from "@nola-lang/runtime";');
    expect(src).toContain('nolaRuntime.configure(config, { source: "nola.config.ts" });');
  });
});
