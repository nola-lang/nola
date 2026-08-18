import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import { beforeAll, describe, expect, it } from "vitest";
import { capture, ensureBuilt } from "./helpers/ensure-built.js";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const FIXTURE = fileURLToPath(new URL("./fixtures/vite-app/", import.meta.url));

// Imported dynamically so this module loads before the workspace dist exists.
async function nolaPlugin() {
  const mod = await import("@nola-lang/vite");
  return mod.default;
}

describe("vite plugin e2e", () => {
  beforeAll(() => ensureBuilt(ROOT), 600_000);

  it("SSR build lowers .tsi, wires config, and the output runs", { timeout: 180_000 }, async () => {
    const nola = await nolaPlugin();
    await build({
      root: FIXTURE,
      plugins: [nola()],
      build: { ssr: "src/entry.ts", outDir: "dist", emptyOutDir: true },
      logLevel: "error",
    });
    const out = await capture(process.execPath, [join(FIXTURE, "dist/entry.js")]);
    expect(JSON.parse(out.trim())).toEqual({ answer: "hello Ada" });
  });

  it("a client build importing .tsi fails with NOLA4001", { timeout: 180_000 }, async () => {
    const nola = await nolaPlugin();
    await expect(
      build({
        root: FIXTURE,
        plugins: [nola()],
        build: {
          outDir: "dist-client",
          emptyOutDir: true,
          rollupOptions: { input: join(FIXTURE, "src/entry.ts") },
        },
        logLevel: "silent",
      }),
    ).rejects.toThrow(/NOLA4001/);
  });
});
