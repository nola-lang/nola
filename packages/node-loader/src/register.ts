import { register } from "node:module";
import { Codes } from "@nola-lang/ast";
import { nolaRuntime } from "@nola-lang/runtime";
import { loadNolaConfig } from "./config.js";

/**
 * The loader IS Node's module customization hooks (`module.register`). Bun and
 * Deno expose `node:module` but do not run the hooks (Bun's `register` is a
 * silent no-op), so a `.tsi` import under them fails later with an opaque
 * "export not found". Fail first, with the invocations that do work: every
 * package manager is fine (`bun install`, `bun run start` — the `nola` bin is
 * a Node script by shebang), only Bun/Deno AS THE RUNTIME is not.
 */
export function assertNodeModuleHooks(versions: Record<string, string | undefined> = process.versions): void {
  const other = versions.bun ? `Bun ${versions.bun}` : versions.deno ? `Deno ${versions.deno}` : undefined;
  if (!other) return;
  throw new Error(
    `${Codes.LoaderHooksUnsupported}: the Nola loader needs Node.js module hooks, which ${other} does not run. ` +
      "Run .tsi code on Node: `bun run start` / `npm start` (the nola bin runs on Node) or " +
      "`node --import nola-lang/register src/main.ts`; `bun --bun` and `bun src/main.ts` cannot load .tsi files.",
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
