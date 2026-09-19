import { NOLA_EMIT } from "@nola-lang/core";
import { __nola } from "@nola-lang/runtime";
import { describe, expect, it } from "vitest";

describe("emit-contract bump enforcement", () => {
  // If this test fails because you changed the __nola surface:
  //   1. bump NOLA_EMIT in packages/core/src/index.ts,
  //   2. update `emit` and the key lists below,
  //   3. update the ambient stub (packages/compiler/src/ambient-stub.ts) and the
  //      `__nola.useRuntime(<N>)` literals pinned in the compiler lowering tests.
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
      // unifying with FunctionCallIntent and the infer-function scope.
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
      // emit 12: the call-intent factory is __nola.intents.FunctionCallIntent
      // (was FunctionCallingIntent) — factory keys mirror the class names, and
      // the class was renamed with the intents/ layout reorganization. An
      // emit-11 runtime has no FunctionCallIntent key.
      // emit 13: extract/call inits carry `def` — the compiler-stamped ask
      // source identity (sha256 over file + raw instruction/callee + type
      // text; line/col excluded; AskDefinition spec 2026-09-01). Namespace
      // keys unchanged — an emit-12 runtime would silently DROP the field,
      // losing definition analytics, hence the bump.
      // emit 14: types as values — every exported type alias / interface in a
      // .tsi also exports `const <Name> = __nola_type_<Name>() as InferType<Name>`,
      // cross-file refs pass `() => <imported value>` to __nola.types.ref (the
      // resolver may now return an InferType OR an accessor function), and the
      // generated import targets `./x.tsi` (companions retired). An emit-13
      // runtime cannot unwrap the new ref resolver, hence the bump.
      // emit 15: checker-backed derivation — literal / union / nullable / tuple /
      // record combinators (+ object's `{ additional }`), and every derivation
      // site in the body calls an appendix accessor (`__nola_type_$N()`) instead
      // of carrying an inline combinator expression. An emit-14 runtime has no
      // union/nullable/… keys, hence the bump.
      // emit 16: JSDoc constraints — a carrier gains `.constrain({ … })` (the
      // JSON Schema validation vocabulary emitted from `@format` / `@minimum` /
      // `@minItems` … tags). A method beside `describe`, so the key snapshot
      // below is unchanged; an emit-15 carrier has no `constrain`, hence the bump.
      // emit 17: scope bodies — `ask` in the module body lowers to
      // `__nola.ask(X, __nola_module_ctx())`: ask's second argument is a Frame
      // OR the module scope node from the new `__nola_file_ctx().module({...})`,
      // and `__nola.context.file(path, emit)` checks the contract (a module-body
      // ask runs before the EOF useRuntime statement). Namespace keys unchanged;
      // an emit-16 runtime has no `.module`, hence the bump.
      // emit 18: decision types — `__nola.types.choice/scale/prob` (the answer
      // shapes of a Choice / Scale / Prob site) and the appendix `import type
      // { Choice, Scale, Prob } from "@nola-lang/runtime"` for the intrinsic
      // names a file uses. An emit-17 runtime has no choice/scale/prob keys,
      // hence the bump.
      emit: 18,
      top: ["ask", "context", "fmt", "intents", "tpl", "types", "useRuntime"],
      context: ["file"],
      intents: ["ExtractIntent", "FunctionCallIntent", "Intent"],
      types: [
        "array",
        "boolean",
        "choice",
        "date",
        "enum",
        "literal",
        "nullable",
        "number",
        "object",
        "optional",
        "prob",
        "record",
        "ref",
        "scale",
        "string",
        "tuple",
        "union",
        "unsupported",
      ],
    });
  });
});
