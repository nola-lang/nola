import { register } from "node:module";
import { nolaRuntime } from "@nola-lang/runtime";
import { loadNolaConfig } from "./config.js";

/**
 * Config loads BEFORE the hooks register: the hooks worker gets no project
 * context of its own, so the compiler section rides in as `register` data —
 * the one channel into the worker — keeping a single config evaluation.
 * (Consequence: nola.config.ts itself cannot import `.tsi` modules.)
 */
export async function registerNola(opts: { dir?: string } = {}): Promise<void> {
  const config = await loadNolaConfig(opts.dir ?? process.cwd());
  register("./hooks.js", { parentURL: import.meta.url, data: { compiler: config?.compiler } });
  if (config) nolaRuntime.configure(config);
}
