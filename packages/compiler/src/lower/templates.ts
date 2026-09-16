import type { Position } from "@nola-lang/ast";
import { NOLA_EMIT, sha256Hex } from "@nola-lang/core";
import { accessorNameFor, type TypeImport } from "../schema-expr.js";
import type { EditAnchor } from "../spans.js";
import { viewSpecifierFor } from "../view-name.js";

/**
 * Every piece of TS text the lowering emits lives here; the Lowerer decides
 * WHERE each piece lands (span mechanics), this module decides WHAT it says.
 */

/**
 * Appended at EOF so no original line/column shifts: ESM hoists the import, and a
 * `function` declaration hoists with its value. `__nola_file_ctx` must NOT be a
 * `const`/`let` — an infer function called during its own module's evaluation
 * (`const eager = go();`) reads it before the declaration runs and hits the TDZ.
 * It holds no state: `__nola.context.file` is memoized by path in the runtime.
 */
export const runtimeImport = (displayFile: string) => `
import { __nola } from "@nola-lang/runtime";
__nola.useRuntime(${NOLA_EMIT});
function __nola_file_ctx() { return __nola.context.file(${JSON.stringify(displayFile)}); }
`;

/**
 * Appendix accessor for a named type. A `function` declaration for the same TDZ
 * reason as `__nola_file_ctx`: a top-level extractor evaluates during module
 * evaluation, before any appendix statement runs. The explicit return type is
 * required — a self-recursive accessor has no inferable return type (TS7023
 * under strict); the inline import type is erased by esbuild and resolves
 * against both the ambient stub and the runtime.
 */
export const typeAccessorDecl = (name: string, expr: string) => accessorDecl(accessorNameFor(name), expr);

/** An appendix accessor by its full name; `optional` is the context-site form (the "omit" policy returns undefined). */
export const accessorDecl = (accessor: string, expr: string, optional = false) =>
  `function ${accessor}(): import("@nola-lang/runtime").InferType<unknown>${optional ? " | undefined" : ""} { return ${expr}; }\n`;

/**
 * Phase-1 accessor body (emit 15): the checker fills it in through
 * finalizeDerivations. The tolerant-mode inert text — assignable to every
 * return type — so phase-1 output is tsc-clean and the editor serves it as is.
 */
export const INERT_ACCESSOR_BODY = "(undefined as never)";
export const inertAccessorDecl = (accessor: string, optional = false) => accessorDecl(accessor, INERT_ACCESSOR_BODY, optional);

/** Site accessors: inline extractor types and parameter annotations, numbered in source order. */
export const siteAccessorName = (n: number) => `__nola_type_$${n}`;

/** An appendix accessor for a type that could not be derived, by its full name: NOLA3009 if it ever reaches an ask. */
export const unsupportedAccessorDeclFor = (accessor: string, reason: string) =>
  `function ${accessor}(): ${unsupportedTypeText(reason)} { return __nola.types.unsupported(${JSON.stringify(reason)}) as ${unsupportedTypeText(reason)}; }\n`;

/**
 * The cast of an exported type's value (emit 15): phase 1 cannot know whether
 * the type derives, so the conditional reads the ACCESSOR's return type — an
 * UnsupportedType accessor makes the use-site elaboration appear, an
 * InferType one resolves to `InferType<Name>` (what hover shows).
 */
export const typeValueText = (name: string) =>
  `import("@nola-lang/runtime").TypeValueOf<typeof ${accessorNameFor(name)}, ${name}>`;

/**
 * The value declaration of an exported type (spec §1, emit 14). Inserted RIGHT
 * AFTER the type declaration, not in the appendix: `const` is not hoisted, so a
 * later top-level statement may use `<Name>` as a value; the accessor it calls
 * is a hoisted function, so the call is legal there. The `as unknown as` cast
 * is the trust boundary until accessors carry precise generics.
 */
export const typeValueDecl = (name: string, typeText: string) =>
  `\nexport const ${name} = ${accessorNameFor(name)}() as unknown as ${typeText};`;

export const inferTypeText = (name: string) => `import("@nola-lang/runtime").InferType<${name}>`;
export const unsupportedTypeText = (reason: string) =>
  `import("@nola-lang/runtime").UnsupportedType<${JSON.stringify(reason)}>`;

/** Appendix accessor for an exported type that could not be derived: NOLA3009 if it ever reaches an ask. */
export const unsupportedAccessorDecl = (name: string, reason: string) =>
  `function ${accessorNameFor(name)}(): ${unsupportedTypeText(reason)} { return __nola.types.unsupported(${JSON.stringify(reason)}) as ${unsupportedTypeText(reason)}; }\n`;

/**
 * Turbopack inline mode (spec §4): the importer-side accessor delegates to the
 * inlined view's accessor; the view's own accessors carry a per-module prefix
 * so they never collide with the importer's `__nola_type_<Name>` functions.
 */
export const inlineBindingDecl = (localName: string, viewAccessor: string) =>
  `function ${accessorNameFor(localName)}(): import("@nola-lang/runtime").InferType<unknown> { return ${viewAccessor}(); }\n`;
export const viewAccessorDecl = (accessor: string, expr: string) =>
  `function ${accessor}(): import("@nola-lang/runtime").InferType<unknown> { return ${expr}; }\n`;
export const viewUnsupportedAccessorDecl = (accessor: string, reason: string) =>
  `function ${accessor}(): ${unsupportedTypeText(reason)} { return __nola.types.unsupported(${JSON.stringify(reason)}) as ${unsupportedTypeText(reason)}; }\n`;

/**
 * Appendix import binding a type's VALUE from its `.tsi` (a real Nola file or
 * the derived view, emit 14). ESM initializes it before this module evaluates
 * unless the graph is cyclic — which is why generated code reads it only
 * inside a ref closure (spec §2).
 */
export const viewImportDecl = (localName: string, imp: TypeImport) =>
  `import { ${imp.importedName} as ${accessorNameFor(localName)} } from ${JSON.stringify(viewSpecifierFor(imp.specifier))};\n`;

/** Human-facing `"line:col"` with BOTH 1-based (AST columns are 0-based). */
export const locText = ({ line, column }: Position) => `${line}:${column + 1}`;

export const ASK_OPEN = "await __nola.ask(";

/** Closes `__nola.ask(`; the `ask with <name>` alias re-enters as the third argument. */
export const askClose = (providerName?: string) =>
  `, __frame${providerName ? `, ${JSON.stringify(providerName)}` : ""})`;

/**
 * The wrapper opener. The `void` read of every named param forces the
 * executor closure to capture them: V8 drops variables an arrow never
 * references, so a `.user` the body does not mention would otherwise be
 * unavailable to the debugger's evaluate — hover over the param showed
 * nothing. One statement per param (a comma expression is TS2695 under
 * strict); they ride the unmapped wrapper line, so stepping never sees them.
 */
export const invocationOpen = (paramNames: string[]) =>
  `\n  return __nola.intents.Intent(async (__frame) => {${paramNames.map((n) => ` void ${n};`).join("")}`;

/** One FunctionScopeInit args entry; only contextual (`.`) params carry the live value. */
export const invocationArgEntry = (name: string, typeExpr: string | undefined, contextual: boolean) =>
  `{ name: ${JSON.stringify(name)}${typeExpr ? `, type: ${typeExpr}` : ""}${contextual ? `, contextual: true, value: ${name}` : ""} }`;

/**
 * The wrapper closer. `instructionField` is the full JS text after
 * `instruction: ` — a JSON string for prose, a template literal for a marker
 * with lexical holes, or `"<raw>", template: (__nola_s) => __nola.tpl\`…\`` for
 * a prompt template (see templateCopy).
 */
export const invocationClose = (fnName: string, instructionField: string, argEntries: string[]) => {
  const argsField = argEntries.length > 0 ? `, args: [${argEntries.join(", ")}]` : "";
  return `  }, __nola_file_ctx().func({ fn: ${JSON.stringify(fnName)}, instruction: ${instructionField}${argsField} }));\n`;
};

/**
 * Copies a template literal's bytes for re-emission elsewhere (marker / call
 * hint — their bytes cannot stay where they are). Scope mode inserts
 * SCOPE_PARAM before every `${.member}` node; fmt mode wraps every hole
 * expression in __nola.fmt(...). Anchors cover the verbatim runs (textOffset
 * relative to the returned text) so editor features survive the move.
 */
export function templateCopy(
  source: string,
  quasi: { start: number; end: number; expressions: Array<{ start: number; end: number }> },
  scopeNodes: Array<{ start: number; end: number }>,
  mode: "scope" | "fmt",
): { text: string; anchors: EditAnchor[] } {
  const inserts: Array<[number, string]> =
    mode === "scope"
      ? scopeNodes.map((n) => [n.start, SCOPE_PARAM] as [number, string])
      : quasi.expressions.flatMap((e) => [[e.start, FMT_OPEN] as [number, string], [e.end, FMT_CLOSE] as [number, string]]);
  inserts.sort((a, b) => a[0] - b[0]);
  let text = "";
  const anchors: EditAnchor[] = [];
  let cursor = quasi.start;
  for (const [pos, ins] of inserts) {
    if (pos > cursor) {
      anchors.push({ sourceStart: cursor, sourceEnd: pos, textOffset: text.length });
      text += source.slice(cursor, pos);
    }
    text += ins;
    cursor = pos;
  }
  anchors.push({ sourceStart: cursor, sourceEnd: quasi.end, textOffset: text.length });
  text += source.slice(cursor, quasi.end);
  return { text, anchors };
}

/** Result type argument recovered from the tagged callee (simple tags only). */
export const callIntentTypeText = (tagText: string) => `<Awaited<ReturnType<typeof ${tagText}>>>`;

export const callIntentOpen = (typeText: string) => `__nola.intents.FunctionCallIntent${typeText}({ fn: `;

/**
 * Stable ask identity (AskDefinition spec §2): sha256 over the raw authored
 * text — file + instruction/callee + type — with line/col excluded by design,
 * so reformatting elsewhere in the file keeps the identity. Never part of the
 * ask fingerprint.
 */
export const defHash = (displayFile: string, kind: "extract" | "call", a: string, b: string): string =>
  sha256Hex(`nola-def:1\n${displayFile}\n${kind}\n${a}\n${b}`);

/** `instructionField` is the full JS text after `instruction: ` (see invocationClose). */
export const callIntentArgsHead = (tagText: string, instructionField: string, loc: Position, def: string) =>
  `, name: ${JSON.stringify(tagText)}, instruction: ${instructionField}, ` +
  `loc: ${JSON.stringify(locText(loc))}, def: ${JSON.stringify(def)}, args: [`;

export const CALL_INTENT_CLOSE = "] })";

/** An untyped extractor resolves as a string. */
export const EXTRACT_DEFAULT_TYPE_EXPR = "__nola.types.string()";
export const EXTRACT_DEFAULT_TYPE_TEXT = "<any>";

/** The extractor's `<T>` echoed as written in the source. */
export const typeArgsText = (sourceText: string) => `<${sourceText}>`;

export const extractOpen = (typeText: string) => `__nola.intents.ExtractIntent${typeText}({ instruction: `;

/** Reserved parameter name of a lowered prompt-template closure. */
export const SCOPE_PARAM = "__nola_s";

/** `template:` field text up to (not including) the copied / in-place literal. */
export const TEMPLATE_OPEN = `template: (${SCOPE_PARAM}) => __nola.tpl`;

/** The literal's inner text, holes verbatim — the string form of a template's instruction. */
export const rawTemplateText = (source: string, quasi: { start: number; end: number }) =>
  source.slice(quasi.start + 1, quasi.end - 1);

/**
 * Extractor opener for a `${.member}` template literal: the raw text as the
 * instruction string, then the closure whose body is the in-place literal.
 */
export const extractOpenTemplate = (typeText: string, rawInstruction: string) =>
  `__nola.intents.ExtractIntent${typeText}({ instruction: ${JSON.stringify(rawInstruction)}, ${TEMPLATE_OPEN}`;

/** Wraps each `${expr}` substitution in the extractor template. */
export const FMT_OPEN = "__nola.fmt(";
export const FMT_CLOSE = ")";

export const extractClose = (typeExpr: string, loc: Position, def: string) =>
  `, type: ${typeExpr}, loc: ${JSON.stringify(locText(loc))}, def: ${JSON.stringify(def)} })`;

/**
 * Stand-in for a construct the parser could only recover as a placeholder —
 * a `..` whose prompt is still being typed, or the reserved `(..)` form. It
 * exists for the EDITOR only (strict mode throws on these, so no build ever
 * emits it) and has two jobs: keep the generated text parseable, and end in a
 * character that is not a dot. TypeScript only answers a `.`-triggered
 * completion when a dot precedes the position, so the half-typed marker stops
 * pulling the whole global scope into the suggestion list. `never` is
 * assignable everywhere, so the placeholder adds no type errors of its own.
 */
export const BROKEN_CONSTRUCT = "(undefined as never)";
