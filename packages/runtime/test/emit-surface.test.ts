import { NOLA_EMIT } from "@nola-lang/core";
import { __nola } from "@nola-lang/runtime";
import { describe, expect, it } from "vitest";

describe("emit-contract bump enforcement", () => {
  // If this test fails because you changed the __nola surface:
  //   1. bump NOLA_EMIT in packages/core/src/index.ts,
  //   2. update `emit` and the key lists below,
  //   3. update BOTH ambient stubs (tshost.ts / typecheck.ts) and RUNTIME_IMPORT's assert literal in tests.
  // Never change the surface without bumping — stale builds would misbehave silently.
  // Runtime-only surfaces (config, hooks, middleware, logger) are NOT part of the
  // emit contract — only the `__nola` namespace the compiler emits calls into is.
  it("the __nola surface matches the snapshot recorded for the current NOLA_EMIT", () => {
    expect({
      emit: NOLA_EMIT,
      top: Object.keys(__nola).sort(),
      context: Object.keys(__nola.context).sort(),
      intents: Object.keys(__nola.intents).sort(),
      types: Object.keys(__nola.types).sort(),
    }).toEqual({
      // emit 2: __nola.resolve gained the optional `provider` alias argument
      // (`ask with <name>` lowering) — an emit-1 runtime would silently drop it.
      // emit 3: __nola.resolve renamed to __nola.ask, and intent inits no longer
      // carry `file` (derived from the context lineage root) — an emit-2 runtime
      // has no `__nola.ask` at all.
      // emit 4: __nola.assertEmit renamed to __nola.useRuntime — the call now
      // attaches the module to the process-wide NolaRuntime instance.
      // emit 5: ask-site schemas are __nola.types combinator expressions
      // (InferType carrier) instead of inline JSON; per-file __nola_type_<Name>
      // accessor functions join the EOF appendix; recursion is legal.
      // emit 6: __nola.types.unsupported — companions (cross-file type modules)
      // export it for underivable types; using one fails the ask with NOLA3009.
      // emit 7: ExtractIntent's init renames — the InferType expression moves
      // under `type` (was `schema` — a misnomer since the emit-5 carrier
      // switch) and the backtick text under `instruction` (was `message`),
      // unifying with FunctionCallingIntent and the infer-function scope.
      // emit 8: the function scope factory moves from InferContext.scope to
      // FileInferContext.func({ fn, instruction, args }) — args carry every
      // param's name (+ InferType when derivable), and `value` only for
      // `..`-contextual params. The file-context accessor moves under a
      // `context` namespace: __nola.fileContext(path) → __nola.context.file(path).
      // An emit-7 runtime has neither .func nor __nola.context at all.
      // emit 9: __nola.types.date — `Date` lowers to a string schema carrying
      // format: "date-time"; the intent revives the wire string to a Date.
      // emit 10: the appendix runtime import retargets nola-lang/runtime →
      // @nola-lang/runtime (vite-style split: nola-lang is the dev tool, apps
      // depend on @nola-lang/runtime). Surface unchanged; specifier only.
      // emit 11: prompt templates — `${.member}` scope holes lower to a
      // `template: (__nola_s) => __nola.tpl`…`` closure on the func / extract /
      // call inits (instruction stays a string), rendered through the new
      // __nola.tpl tag. An emit-10 runtime has no tpl and ignores template.
      emit: 11,
      top: ["ask", "context", "fmt", "intents", "tpl", "types", "useRuntime"],
      context: ["file"],
      intents: ["ExtractIntent", "FunctionCallingIntent", "Intent"],
      types: ["array", "boolean", "date", "enum", "number", "object", "optional", "ref", "string", "unsupported"],
    });
  });
});
