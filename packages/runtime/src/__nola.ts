import { ask, fmt, tpl } from "./ask/index.js";
import { intents } from "./intents/index.js";
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
     * `emit` is the contract the calling module was compiled for. The EOF
     * `useRuntime(n)` statement runs AFTER a module body's top-level asks, so
     * the accessor — the first thing such an ask touches — checks it too.
     */
    file: (file: string, emit?: number) => {
      if (emit !== undefined) useRuntime(emit);
      return nolaRuntime.current().fileContext(file);
    },
  },
  ask,
  fmt,
  tpl,
  useRuntime,
};
