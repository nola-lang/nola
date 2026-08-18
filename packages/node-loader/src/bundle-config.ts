import { basename, dirname } from "node:path";
import { Codes } from "@nola-lang/ast";
import { NolaConfigError } from "@nola-lang/runtime";
import { build, type Plugin } from "esbuild";

/** Refuse .tsi in the config graph: the config is evaluated before the Nola loader registers. */
const refuseTsi: Plugin = {
  name: "nola-refuse-tsi",
  setup(b) {
    b.onResolve({ filter: /\.tsi$/ }, (args) => ({
      errors: [
        {
          text: `${Codes.ConfigImportsTsi}: nola.config.ts cannot import ".tsi" modules ("${args.path}" imported from ${args.importer}) — the config is evaluated before the Nola loader registers.`,
        },
      ],
    }));
  },
};

type BundleSource = { entryPoints: [string] } | { stdin: { contents: string; resolveDir: string; loader: "ts" } };

async function runBundle(source: BundleSource, configPath: string): Promise<string> {
  try {
    const result = await build({
      ...source,
      bundle: true,
      platform: "node",
      format: "esm",
      packages: "external",
      write: false,
      absWorkingDir: dirname(configPath),
      logLevel: "silent",
      plugins: [refuseTsi],
    });
    return result.outputFiles[0]?.text ?? "";
  } catch (err) {
    const messages = (err as { errors?: { text: string }[] }).errors ?? [];
    const tsi = messages.find((m) => m.text.includes(Codes.ConfigImportsTsi));
    if (tsi) throw new NolaConfigError(tsi.text, Codes.ConfigImportsTsi);
    throw err;
  }
}

/**
 * Bundle nola.config.ts into one ESM module string. Relative and
 * tsconfig-paths imports are inlined (middleware/hooks in src travel with the
 * config); bare package specifiers stay external so module-level state is
 * never duplicated between the config bundle and the app's own imports.
 * The default export is preserved.
 */
export async function bundleConfig(configPath: string): Promise<string> {
  return runBundle({ entryPoints: [configPath] }, configPath);
}

/**
 * The dist artifact for app builds: the bundled config plus a wrapper that
 * applies it to the process runtime on import. Importing it is idempotent
 * (ESM module cache); a manual configure() in the entry's body still wins —
 * body code runs after imports and before the first-ask latch.
 */
export async function bundleSelfConfiguringConfig(configPath: string): Promise<string> {
  const entry = [
    `import config from ${JSON.stringify(`./${basename(configPath)}`)};`,
    `import { nolaRuntime } from "@nola-lang/runtime";`,
    `nolaRuntime.configure(config, { source: "nola.config.ts" });`,
    "",
  ].join("\n");
  return runBundle({ stdin: { contents: entry, resolveDir: dirname(configPath), loader: "ts" } }, configPath);
}
