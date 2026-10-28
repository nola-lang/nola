import { register } from "node:module";
import { Codes } from "@nola-lang/ast";
import { nolaRuntime } from "@nola-lang/runtime";
import { loadNolaConfig } from "./config.js";

/**
 * The loader IS Node's module customization hooks (`module.register`). Bun and
 * Deno expose `node:module` but do not run the hooks (Bun's `register` is a
 * silent no-op), so a `.tsi` import under them fails later with an opaque
 * "export not found". Fail first, naming what works: on Bun, `@nola-lang/bun`'s
 * preload loads .tsi from source; on any runtime, the `nola` bin runs on Node
 * by shebang (`bun run start`); Deno has no loader at all.
 */
export function assertNodeModuleHooks(versions: Record<string, string | undefined> = process.versions): void {
  const other = versions.bun ? `Bun ${versions.bun}` : versions.deno ? `Deno ${versions.deno}` : undefined;
  if (!other) return;
  const route = versions.bun
    ? 'Run .tsi on Bun with @nola-lang/bun: add `preload = ["@nola-lang/bun/preload"]` to bunfig.toml and run `bun src/main.tsi`. Or run on Node: '
    : "Deno cannot load .tsi (no module hooks, no plugin API). Run on Node: ";
  throw new Error(
    `${Codes.LoaderHooksUnsupported}: the Nola loader needs Node.js module hooks, which ${other} does not run. ${route}` +
      "`npm start` / `bun run start` (the nola bin runs on Node) or `node --import nola-lang/register src/main.ts`.",
  );
}

/**
 * Config loads BEFORE the hooks register: the hooks worker gets no project
 * context of its own, so the compiler section rides in as `register` data —
 * the one channel into the worker — keeping a single config evaluation.
 * (Consequence: nola.config.ts itself cannot import `.tsi` modules.)
 */
export async function registerNola(opts: { dir?: string } = {}): Promise<void> {
  assertNodeModuleHooks();
  const config = await loadNolaConfig(opts.dir ?? process.cwd());
  register("./hooks.js", { parentURL: import.meta.url, data: { compiler: config?.compiler } });
  if (config) nolaRuntime.configure(config);
}
