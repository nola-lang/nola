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
 * `function` declaration hoists with its value. `__nola_module_ctx` must NOT be a
 * `const`/`let` — an infer function called during its own module's evaluation
 * (`const eager = go();`) reads it before the declaration runs and hits the TDZ.
 * It holds no state: `__nola.context.module` is memoized by path in the runtime.
 *
 * The leading `;` closes whatever the source ends with. In tolerant mode a
 * dangling `console.` at the end of the file is kept verbatim (so TypeScript
 * completes the members itself), and TypeScript reads `console.` + newline +
 * `import { __nola } ...` as the property access `console.import` — its
 * keyword-on-the-next-line recovery fires only when the keyword is followed
 * by an identifier on the same line, and `{` is not one. That swallowed the
 * runtime import and turned every `__nola` in the file into TS2304 at the
 * ask sites. With the `;` TypeScript reports its own "Identifier expected"
 * at the dot and the appendix parses; the same idiom bundlers use between
 * concatenated modules.
 */
export const runtimeImport = (
  displayFile: string,
  moduleInit?: ModuleInitFields,
  decisionTypes: readonly string[] = [],
) => `
;
import { __nola } from "@nola-lang/runtime";
${decisionTypes.length > 0 ? `import type { ${decisionTypes.join(", ")} } from "@nola-lang/runtime";\n` : ""}__nola.useRuntime(${NOLA_EMIT});
${moduleAccessorDecl(displayFile, moduleInit)}`;

/** The static half of the module scope (scope-bodies spec §5.2): what the accessor's init thunk returns. */
export interface ModuleInitFields {
  /** the module's TOP-LEVEL context items in source order (spec 2026-09-29 §3.3) — the canonical order every union is sorted by */
  itemNames: readonly string[];
  localEntries: string[];
}

export const MODULE_SCOPE_CALL = "__nola_module_ctx()";

/**
 * The one accessor of a file (emit 19): the runtime's memoized module node —
 * lineage root, `<module>` scope and parent of the file's infer functions.
 * Hoisted for the TDZ reason above, and it carries the emit contract because
 * a module-body ask runs before the `useRuntime` statement. The init is a
 * THUNK so an infer-function call, which reaches the accessor too, never
 * rebuilds the init object (nor the locals' type carriers): the runtime reads
 * it once, when the node is created. Everything in it is static text.
 */
const moduleAccessorDecl = (displayFile: string, init?: ModuleInitFields) => {
  const fields = [
    ...(init && init.itemNames.length > 0 ? [`context: [${init.itemNames.join(", ")}]`] : []),
    ...(init && init.localEntries.length > 0 ? [`locals: [${init.localEntries.join(", ")}]`] : []),
  ];
  const thunk = fields.length > 0 ? `, () => ({ ${fields.join(", ")} })` : "";
  return `function __nola_module_ctx() { return __nola.context.module(${JSON.stringify(displayFile)}, ${NOLA_EMIT}${thunk}); }\n`;
};

/**
 * A context statement lowered in place (spec 2026-09-29 §3.3): a hoisted
 * function whose body is the statement's parts joined into one `__nola.ctx`
 * tagged template, behind a `void <name>;` read of it. A function declaration
 * because the module init thunk references module items and a circular import
 * can reach the accessor before the module's first statement runs, so the item
 * has to exist before its line executes. The read in front of it is the
 * statement's STEP LOCATION: a declaration alone has none, so a breakpoint on
 * the line resolved into the thunk and paused when an ask rendered the item —
 * mid-ask, with F10 then touring the other items as the runtime read them
 * (playground report 2026-09-29). With the read, the breakpoint binds at the
 * statement's own position, pauses when execution passes it in source order,
 * and F10 walks on to the next line; rendering never pauses in the thunk,
 * since a step over the ask does not enter its callees. Inside a block the
 * declaration is block-scoped under strict mode, which is exactly the
 * visibility rule.
 */
export const contextItemName = (n: number) => `__nola_ctx_${n}`;
export const contextItemOpen = (name: string) => `void ${name}; function ${name}() { return __nola.ctx`;
export const CONTEXT_ITEM_CLOSE = "; }";
/**
 * Two text parts glued with nothing between them concatenate — except when the
 * left ends with an unescaped `$` and the right starts with `{`, which would
 * open a hole: there this empty one keeps them apart.
 */
// biome-ignore lint/suspicious/noTemplateCurlyInString: the emitted hole itself, spliced into a template literal
export const TEXT_JOIN_HOLE = '${""}';

/** The static half of a body's contextual bindings (`locals: [{ name, type? }]`), or nothing. */
const localsField = (localEntries: string[], lead: string) =>
  localEntries.length > 0 ? `${lead}locals: [${localEntries.join(", ")}]` : "";

/**
 * The ask-site options (spec 2026-09-29 §3.3): the `ask with <name>` alias,
 * the visible contextual bindings by shorthand, the visible context items by
 * name. Absent when all three are absent, so a bare ask lowers as before.
 */
export const askSiteArg = (providerName?: string, locals: readonly string[] = [], items: readonly string[] = []) => {
  const fields = [
    ...(providerName ? [`model: ${JSON.stringify(providerName)}`] : []),
    ...(locals.length > 0 ? [`locals: { ${locals.join(", ")} }`] : []),
    ...(items.length > 0 ? [`context: [${items.join(", ")}]`] : []),
  ];
  return fields.length > 0 ? `{ ${fields.join(", ")} }` : undefined;
};

/**
 * Appendix accessor for a named type. A `function` declaration for the same TDZ
 * reason as `__nola_module_ctx`: a top-level extractor evaluates during module
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
 * is the trust boundary until accessors carry precise generics. On the SAME
 * line as the declaration's end — a mid-file newline would shift every later
 * line, and the debugger binds a `.tsi` breakpoint by raw line as well as
 * through the map (see node-loader's stripTypes), so lowering must keep the
 * source's line layout outside the EOF appendix.
 */
export const typeValueDecl = (name: string, typeText: string) =>
  ` export const ${name} = ${accessorNameFor(name)}() as unknown as ${typeText};`;

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

/** The frame an infer wrapper's executor receives — what an infer-body ask runs on. */
export const FRAME_PARAM = "__frame";

/** Closes `__nola.ask(` over the asking scope; the ask-site options object (askSiteArg) is the third argument when present. */
export const askClose = (scope: string, site?: string) => `, ${scope}${site ? `, ${site}` : ""})`;

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
 * The wrapper closer. `moduleItems` are the module's top-level context items
 * above the function's declaration — its lexical view of the module (spec
 * 2026-09-29 §3.3); omitted when none precede it. There is no `instruction`
 * field: a function's context items are passed by the asks that see them.
 */
export const invocationClose = (
  fnName: string,
  argEntries: string[],
  localEntries: string[] = [],
  moduleItems: readonly string[] = [],
) => {
  const argsField = argEntries.length > 0 ? `, args: [${argEntries.join(", ")}]` : "";
  const moduleField = moduleItems.length > 0 ? `, moduleContext: [${moduleItems.join(", ")}]` : "";
  return `  }, __nola_module_ctx().func({ fn: ${JSON.stringify(fnName)}${argsField}${localsField(localEntries, ", ")}${moduleField} }));\n`;
};

/**
 * Copies a call hint's template literal for re-emission in the args head —
 * the one literal whose bytes cannot stay where they are (scope instructions
 * lower in place). Every hole expression is wrapped in __nola.fmt(...); a
 * tolerant placeholder hole (a stray `${.` mid-typing) becomes the inert
 * text instead, since its bytes are not TypeScript. Anchors cover the
 * verbatim runs (textOffset relative to the returned text) so editor
 * features survive the move.
 */
export function templateCopy(
  source: string,
  quasi: { start: number; end: number; expressions: Array<{ start: number; end: number }> },
  placeholders: ReadonlyArray<{ start: number; end: number }> = [],
): { text: string; anchors: EditAnchor[] } {
  const ops: Array<{ at: number; text: string; skipTo?: number }> = [];
  for (const e of quasi.expressions) {
    if (placeholders.some((p) => p.start === e.start && p.end === e.end)) {
      ops.push({ at: e.start, text: BROKEN_CONSTRUCT, skipTo: e.end });
    } else {
      ops.push({ at: e.start, text: FMT_OPEN }, { at: e.end, text: FMT_CLOSE });
    }
  }
  ops.sort((a, b) => a.at - b.at);
  let text = "";
  const anchors: EditAnchor[] = [];
  let cursor = quasi.start;
  for (const op of ops) {
    if (op.at > cursor) {
      anchors.push({ sourceStart: cursor, sourceEnd: op.at, textOffset: text.length });
      text += source.slice(cursor, op.at);
    }
    text += op.text;
    cursor = op.skipTo ?? op.at;
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

/** `instructionField` is the full JS text after `instruction: ` — a JSON string for prose, the hint's copy for a hint with holes. */
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

/** The literal's inner text, holes verbatim — what `def` hashes. */
export const rawTemplateText = (source: string, quasi: { start: number; end: number }) =>
  source.slice(quasi.start + 1, quasi.end - 1);

/** Wraps each `${expr}` substitution of an instruction literal. */
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
