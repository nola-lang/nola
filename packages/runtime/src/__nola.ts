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
    file: (file: string) => nolaRuntime.current().fileContext(file),
  },
  ask,
  fmt,
  tpl,
  useRuntime,
};
