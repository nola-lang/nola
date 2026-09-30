import { ask, ctx, fmt } from "./ask/index.js";
import { intents } from "./intents/index.js";
import type { ModuleScopeInit } from "./intents/invocation/module-context.js";
import { nolaRuntime, useRuntime } from "./runtime/index.js";
import { inferTypes } from "./types/infer-type.js";

/**
 * The namespace lowered code calls: intent factories under `intents`, context
 * accessors under `context`, helpers at the top.
 */
export const __nola = {
  intents,
  types: inferTypes,
  context: {
    /**
     * The one node of a .tsi file (emit 19). `emit` is the contract the calling
     * module was compiled for: the EOF `useRuntime(n)` statement runs AFTER a
     * module body's top-level asks, so the accessor — the first thing such an
     * ask touches — checks it too. `init` (the module's top-level context items
     * — functions read at each ask — and its bindings) is a thunk read once,
     * when the node is created.
     */
    module: (file: string, emit?: number, init?: () => ModuleScopeInit) => {
      if (emit !== undefined) useRuntime(emit);
      return nolaRuntime.current().moduleContext(file, init);
    },
  },
  ask,
  /** the context statement tag (spec 2026-09-29 §3.3): text parts with every value formatted by fmt */
  ctx,
  fmt,
  useRuntime,
};
