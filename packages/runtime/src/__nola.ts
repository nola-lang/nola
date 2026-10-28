import { ask, ctx, fmt } from "./ask/index.js";
import { intents } from "./intents/index.js";
import type { ModuleScopeInit } from "./intents/invocation/module-context.js";
import { instructionParts } from "./intents/parts.js";
import { toolSource, toolSpreadSource, toolVerdicts } from "./intents/tool-use/tool-group.js";
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
  /** emit 23 (spec 2026-10-09): one tool list entry — a function or a bare group — deferred until the ask materializes the list */
  tool: toolSource,
  /** emit 23: a spread entry — a group flattened into the list */
  toolSpread: toolSpreadSource,
  /** emit 23: the group verdicts the appendix accessors return */
  tools: toolVerdicts,
  /** emit 24 (spec 2026-10-12): the value parts of an ask sequence — `obj`, `tools`, `func` */
  var: instructionParts,
};
