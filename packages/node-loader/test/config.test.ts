import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadBuildOptions, loadCompilerOptions, loadNolaConfig } from "@nola-lang/node-loader";
import { describe, expect, it } from "vitest";

const INLINE_CONFIG = [
  "const provider = { name: 'inline', complete: async () => ({ text: '\"x\"' }) };",
  "export default { providers: { default: provider } };",
  "",
].join("\n");

// Reads an env var at config-eval time so tests can observe whether .env was applied.
const CONFIG_READS_ENV = [
  "const provider = { name: process.env.NOLA_TEST_ENV_VAR ?? 'unset', complete: async () => ({ text: '\"x\"' }) };",
  "export default { providers: { default: provider } };",
  "",
].join("\n");

describe("loadNolaConfig", () => {
  it("returns null when no config exists", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nola-nocfg-"));
    expect(await loadNolaConfig(dir)).toBeNull();
  });

  it("compiles and imports nola.config.ts (TS syntax allowed)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nola-cfg-"));
    const tsConfig = `const n: number = 1;\n${INLINE_CONFIG}`;
    await writeFile(join(dir, "nola.config.ts"), tsConfig);
    const cfg = await loadNolaConfig(dir);
    expect(cfg?.providers.default.name).toBe("inline");
    expect((await cfg?.providers.default.complete({ system: "", messages: [] }))?.text).toBe('"x"');
  });

  it("finds the config in a parent directory", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nola-parent-"));
    await writeFile(join(dir, "nola.config.ts"), INLINE_CONFIG);
    const child = join(dir, "a", "b");
    await mkdir(child, { recursive: true });
    const cfg = await loadNolaConfig(child);
    expect(cfg?.providers.default.name).toBe("inline");
  });

  it("rejects configs without providers, naming the config path", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nola-badcfg-"));
    await writeFile(join(dir, "nola.config.ts"), "export default {};\n");
    const err = (await loadNolaConfig(dir).catch((e: unknown) => e)) as Error;
    expect(err.message).toMatch(/`providers`/);
    expect(err.message).toMatch(/nola\.config\.ts/);
  });

  it("rejects the legacy { provider } shape with a migration hint", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nola-legacy-"));
    await writeFile(
      join(dir, "nola.config.ts"),
      "export default { provider: { name: 'x', complete: async () => ({ text: '\"x\"' }) } };\n",
    );
    await expect(loadNolaConfig(dir)).rejects.toThrow(/providers: \{ default:/);
  });

  it("loads .env from the config directory before evaluating the config", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nola-dotenv-"));
    await writeFile(join(dir, "nola.config.ts"), CONFIG_READS_ENV);
    await writeFile(join(dir, ".env"), "NOLA_TEST_ENV_VAR=from-dotenv\n");
    delete process.env.NOLA_TEST_ENV_VAR;
    try {
      const cfg = await loadNolaConfig(dir);
      expect(cfg?.providers.default.name).toBe("from-dotenv");
    } finally {
      delete process.env.NOLA_TEST_ENV_VAR;
    }
  });

  it("supports a config importing project .ts modules, including tsconfig paths (bundled eval)", async () => {
    // The alias form is the version-independent gate: Node 22.18+ strips types
    // natively for relative .ts imports, but no Node resolves tsconfig paths.
    const dir = await mkdtemp(join(tmpdir(), "nola-cfg-bundled-"));
    await mkdir(join(dir, "src"), { recursive: true });
    await writeFile(
      join(dir, "tsconfig.json"),
      JSON.stringify({ compilerOptions: { baseUrl: ".", paths: { "@cfg/*": ["./src/*"] } } }),
    );
    await writeFile(
      join(dir, "src", "provider.ts"),
      "export const canned = { name: 'from-src', complete: async () => ({ text: '\"x\"' }) };\n",
    );
    await writeFile(
      join(dir, "nola.config.ts"),
      "import { canned } from '@cfg/provider.ts';\nexport default { providers: { default: canned } };\n",
    );
    const cfg = await loadNolaConfig(dir);
    expect(cfg?.providers.default.name).toBe("from-src");
  });

  it("carries a validated compiler section", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nola-cfg-compiler-"));
    await writeFile(
      join(dir, "nola.config.ts"),
      `${INLINE_CONFIG.replace("export default {", "export default { compiler: { underivableContextType: 'prune' },")}`,
    );
    const cfg = await loadNolaConfig(dir);
    expect(cfg?.compiler.underivableContextType).toBe("prune");
  });

  it("does not override a value already present in the environment", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nola-dotenv-override-"));
    await writeFile(join(dir, "nola.config.ts"), CONFIG_READS_ENV);
    await writeFile(join(dir, ".env"), "NOLA_TEST_ENV_VAR=from-dotenv\n");
    process.env.NOLA_TEST_ENV_VAR = "from-shell";
    try {
      const cfg = await loadNolaConfig(dir);
      expect(cfg?.providers.default.name).toBe("from-shell");
    } finally {
      delete process.env.NOLA_TEST_ENV_VAR;
    }
  });
});

describe("loadCompilerOptions", () => {
  it("defaults to error when no config exists", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nola-copt-nocfg-"));
    expect(await loadCompilerOptions(dir)).toEqual({ underivableContextType: "error" });
  });

  it("reads the compiler section WITHOUT demanding a runtime-valid config", async () => {
    // No providers at all: `nola build`/`check` must still work on this project.
    const dir = await mkdtemp(join(tmpdir(), "nola-copt-"));
    await writeFile(join(dir, "nola.config.ts"), "export default { compiler: { underivableContextType: 'omit' } };\n");
    expect(await loadCompilerOptions(dir)).toEqual({ underivableContextType: "omit" });
  });

  it("rejects an invalid mode, naming the config path", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nola-copt-bad-"));
    await writeFile(join(dir, "nola.config.ts"), "export default { compiler: { underivableContextType: 'loose' } };\n");
    const err = (await loadCompilerOptions(dir).catch((e: unknown) => e)) as Error;
    expect(err.message).toMatch(/underivableContextType must be one of error, prune, omit/);
    expect(err.message).toMatch(/nola\.config\.ts/);
  });
});

describe("loadBuildOptions", () => {
  it("defaults to app with null configPath when no config exists", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nola-bopt-nocfg-"));
    expect(await loadBuildOptions(dir)).toEqual({ target: "app", configPath: null });
  });

  it("reads target lib WITHOUT demanding a runtime-valid config, reporting the config path", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nola-bopt-lib-"));
    await writeFile(join(dir, "nola.config.ts"), "export default { build: { target: 'lib' } };\n");
    expect(await loadBuildOptions(dir)).toEqual({ target: "lib", configPath: join(dir, "nola.config.ts") });
  });

  it("rejects an invalid target, naming the config path", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nola-bopt-bad-"));
    await writeFile(join(dir, "nola.config.ts"), "export default { build: { target: 'exe' } };\n");
    const err = (await loadBuildOptions(dir).catch((e: unknown) => e)) as Error;
    expect(err.message).toMatch(/build\.target must be one of app, lib/);
    expect(err.message).toMatch(/nola\.config\.ts/);
  });
});
