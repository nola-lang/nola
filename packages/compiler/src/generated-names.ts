// Names the lowering puts in the generated text — the runtime import `__nola`,
// the executor's `__frame`, the appendix accessors `__nola_module_ctx` and
// `__nola_type_…`, the context items `__nola_ctx_N` — are in scope wherever the
// author types and are reported like the author's own. The author cannot act
// on either, so `nola check`, the tsserver plugin and the language server hide
// them through these two predicates. TypeScript-free on purpose: the compiler
// has no TypeScript dependency; each host flattens its own message text.

/** TS6133: "'{0}' is declared but its value is never read." */
const UNUSED_DECLARATION = 6133;

/**
 * `__nola_` at the start of a name, whatever the message's locale puts around
 * it — `'…'` in English, `“…”` in zh-CN, `"…"` in de, nothing in cs — since
 * the editors load TypeScript's localized messages.
 */
const GENERATED_NAME_IN_MESSAGE = /(?:^|[^\w$])__nola_/;

/**
 * An unused-declaration report on a generated name, which `noUnusedLocals`
 * reports (a `_` prefix does not exempt a declaration) and the editors grey
 * out as unused code even without the flag. A context item no ask sees was
 * the case that surfaced it — a hoisted `function __nola_ctx_N()` nothing
 * read; its `void __nola_ctx_N;` step-location read now references it, and
 * the filter stays for any generated declaration nothing reads.
 */
export function isGeneratedNameDiagnostic(code: number, messageText: string): boolean {
  return code === UNUSED_DECLARATION && GENERATED_NAME_IN_MESSAGE.test(messageText);
}

/** A name the lowering declares — never one to offer in identifier completion. */
export function isGeneratedIdentifier(name: string): boolean {
  return name.startsWith("__nola") || name === "__frame";
}
