// bunfig.toml: preload = ["@nola-lang/bun/preload"] (and under [test]) — the runtime
// plugin, then the project's nola.config.ts, before the entry runs. The plugin registers
// FIRST so a .tsi in the config graph meets NOLA3012 instead of an unknown-extension
// error; the context memo is shared, so the config is evaluated once.

import { nolaRuntime } from "@nola-lang/runtime";
import { plugin } from "bun";
import { assertBunVersion } from "./guards.js";
import { nola } from "./index.js";
import { projectForDir } from "./project.js";

assertBunVersion();
const options = { config: false as const };
plugin(nola(options));
const ctx = await projectForDir(process.cwd(), options);
// Without a config nothing is configured — the first ask fails with the runtime's own unconfigured error, as under the Node loader.
if (ctx.config !== null) nolaRuntime.configure(ctx.config, { source: "nola.config.ts" });
