import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bundleConfig, bundleSelfConfiguringConfig } from "@nola-lang/node-loader";
import { describe, expect, it } from "vitest";

const PROVIDER_TS = "export const canned = { name: 'canned', complete: async () => ({ text: '\"hi\"' }) };\n";

async function makeProject(prefix: string, config: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  await mkdir(join(dir, "src"), { recursive: true });
  await writeFile(join(dir, "src", "provider.ts"), PROVIDER_TS);
  await writeFile(join(dir, "nola.config.ts"), config);
  return dir;
}

describe("bundleConfig", () => {
  it("inlines relative .ts imports (middleware/providers in src)", async () => {
    const dir = await makeProject(
      "nola-bundle-rel-",
      "import { canned } from './src/provider.ts';\nexport default { providers: { default: canned } };\n",
    );
    const code = await bundleConfig(join(dir, "nola.config.ts"));
    expect(code).toContain("canned");
    expect(code).not.toMatch(/from\s+["']\.\/src\/provider/);
  });

  it("keeps bare package specifiers external", async () => {
    const dir = await makeProject(
      "nola-bundle-ext-",
      "import { defineConfig } from '@nola-lang/runtime';\nexport default defineConfig({ providers: {} } as never);\n",
    );
    const code = await bundleConfig(join(dir, "nola.config.ts"));
    expect(code).toMatch(/from\s+["']@nola-lang\/runtime["']/);
  });

  it("inlines tsconfig paths aliases", async () => {
    const dir = await makeProject(
      "nola-bundle-alias-",
      "import { marker } from '@app/helper.ts';\nexport default { providers: {}, note: marker };\n",
    );
    await writeFile(
      join(dir, "tsconfig.json"),
      JSON.stringify({ compilerOptions: { baseUrl: ".", paths: { "@app/*": ["./src/*"] } } }),
    );
    await writeFile(join(dir, "src", "helper.ts"), "export const marker = 'ALIAS_INLINED';\n");
    const code = await bundleConfig(join(dir, "nola.config.ts"));
    expect(code).toContain("ALIAS_INLINED");
  });

  it("refuses .tsi in the config graph with NOLA3012", async () => {
    const dir = await makeProject("nola-bundle-tsi-", "import './extract.tsi';\nexport default { providers: {} };\n");
    await writeFile(join(dir, "extract.tsi"), "export const v = ..`x`<string>;\n");
    const err = (await bundleConfig(join(dir, "nola.config.ts")).catch((e: unknown) => e)) as Error & { code?: string };
    expect(err.message).toContain("NOLA3012");
    expect(err.code).toBe("NOLA3012");
  });
});

describe("bundleSelfConfiguringConfig", () => {
  it("emits a module that applies the config on import, runtime external", async () => {
    const dir = await makeProject(
      "nola-bundle-self-",
      "import { canned } from './src/provider.ts';\nexport default { providers: { default: canned } };\n",
    );
    const code = await bundleSelfConfiguringConfig(join(dir, "nola.config.ts"));
    expect(code).toContain("nolaRuntime.configure(");
    expect(code).toMatch(/from\s*["']@nola-lang\/runtime["']/);
    expect(code).toContain("canned");
  });
});
