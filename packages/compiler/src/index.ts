export type { SourceMap } from "magic-string";
export { RUNTIME_AMBIENT_STUB } from "./ambient-stub.js";
export { type CompanionResult, compileCompanion } from "./companion.js";
export {
  companionSourceCandidates,
  companionSpecifierFor,
  isCompanionSpecifier,
  isReservedNolaName,
  loweredVirtualNameFor,
  moduleIdFor,
} from "./companion-name.js";
export { compileNola } from "./compile.js";
export { displayPathFor } from "./path.js";
export { collectTypeRegistry, deriveSchema, type SchemaResult } from "./schema.js";
export {
  type AccessorPlan,
  accessorNameFor,
  buildAccessorPlan,
  type CompanionImport,
  collectTypeImports,
  type DeriveContext,
  deriveTypeExpr,
  type TypeExprResult,
} from "./schema-expr.js";
export { type Anchor, type EditAnchor, type Span, type SpanKind, SpanRecorder } from "./spans.js";
export { type StaticContextTypeMode, staticUnderivableContextType } from "./static-config.js";
export type { CompileOptions, CompileResult } from "./types.js";
