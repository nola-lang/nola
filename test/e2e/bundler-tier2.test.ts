import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { ensureBuilt } from "./helpers/ensure-built.js";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const FIXTURE = fileURLToPath(new URL("./fixtures/tier2-app/", import.meta.url));

function runEntry(outFile: string): unknown {
  const out = execFileSync(process.execPath, [join(FIXTURE, outFile)], { encoding: "utf8" });
  return JSON.parse(out.trim());
}

describe("tier-2 smokes", () => {
  beforeAll(() => ensureBuilt(ROOT), 600_000);

  it("rollup bundles and the output runs", { timeout: 180_000 }, async () => {
    const { default: nola } = await import("@nola-lang/rollup");
    const { rollup } = await import("rollup");
    const bundle = await rollup({
      input: join(FIXTURE, "src/entry.ts"),
      plugins: [nola()],
      external: (id) => id.startsWith("@nola-lang/") || id.startsWith("node:"),
      logLevel: "silent",
    });
    await bundle.write({ file: join(FIXTURE, "dist-rollup/entry.js"), format: "esm" });
    await bundle.close();
    expect(runEntry("dist-rollup/entry.js")).toEqual({ answer: "hello Ada" });
  });

  it("rolldown bundles and the output runs", { timeout: 180_000 }, async () => {
    const { default: nola } = await import("@nola-lang/rolldown");
    const { rolldown } = await import("rolldown");
    const bundle = await rolldown({
      input: join(FIXTURE, "src/entry.ts"),
      platform: "node",
      plugins: [nola()],
      external: (id: string) => id.startsWith("@nola-lang/") || id.startsWith("node:"),
      logLevel: "silent",
    });
    await bundle.write({ file: join(FIXTURE, "dist-rolldown/entry.js"), format: "esm" });
    await bundle.close();
    expect(runEntry("dist-rolldown/entry.js")).toEqual({ answer: "hello Ada" });
  });

  it("esbuild bundles and the output runs", { timeout: 180_000 }, async () => {
    const { default: nola } = await import("@nola-lang/esbuild");
    const { build } = await import("esbuild");
    await build({
      entryPoints: [join(FIXTURE, "src/entry.ts")],
      bundle: true,
      platform: "node",
      format: "esm",
      packages: "external",
      outfile: join(FIXTURE, "dist-esbuild/entry.js"),
      plugins: [nola()],
      logLevel: "silent",
    });
    expect(runEntry("dist-esbuild/entry.js")).toEqual({ answer: "hello Ada" });
  });

  it("rspack bundles and the output runs", { timeout: 180_000 }, async () => {
    const { default: nola } = await import("@nola-lang/rspack");
    const { rspack } = await import("@rspack/core");
    await new Promise<void>((resolvePromise, reject) => {
      rspack(
        {
          mode: "production",
          target: "node22",
          context: FIXTURE,
          entry: join(FIXTURE, "src/entry.ts"),
          output: { path: join(FIXTURE, "dist-rspack"), filename: "entry.cjs", clean: true },
          resolve: {
            extensions: [".ts", ".js"],
            extensionAlias: { ".js": [".js", ".ts"] },
          },
          module: {
            rules: [{ test: /\.ts$/, type: "javascript/auto", use: [{ loader: "builtin:swc-loader" }] }],
          },
          plugins: [nola()],
          devtool: false,
        },
        (err, stats) => {
          if (err) return reject(err);
          if (stats?.hasErrors()) return reject(new Error(stats.toString({ errors: true })));
          resolvePromise();
        },
      );
    });
    expect(runEntry("dist-rspack/entry.cjs")).toEqual({ answer: "hello Ada" });
  });
});
