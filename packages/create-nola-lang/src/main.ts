#!/usr/bin/env node
import { dispatch } from "./cli.js";
import { CREATE_COMMAND } from "./flow.js";
import { ownVersion } from "./scaffold.js";

// A single-command bin: `npm create nola-lang [dir] [flags]`. Routing through
// the shared dispatcher (tool "npm create", command "nola-lang") gives it
// `--help`/`--version` and the same usage errors as `nola init`, which
// declares the same flags (FLOW_OPTIONS).
try {
  const raw = process.argv.slice(2);
  const version = await ownVersion();
  if (raw[0] === "--version" || raw[0] === "-v") {
    process.exit(await dispatch(raw, [CREATE_COMMAND], { name: "create-nola-lang", version }));
  }
  process.exit(await dispatch([CREATE_COMMAND.name, ...raw], [CREATE_COMMAND], { name: "npm create", version }));
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}
