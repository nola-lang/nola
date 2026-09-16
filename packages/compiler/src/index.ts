export type { SourceMap } from "magic-string";
export { RUNTIME_AMBIENT_STUB } from "./ambient-stub.js";
export { compileNola } from "./compile.js";
export { finalizeDerivations } from "./finalize.js";
export { displayPathFor } from "./path.js";
export {
  collectExportedTypeNames,
  collectTopLevelValueNames,
  collectTypeRegistry,
  type ExportedTypeDecl,
} from "./schema.js";
export { accessorNameFor, collectTypeImports, type TypeImport } from "./schema-expr.js";
export { type Anchor, type EditAnchor, type Span, type SpanKind, SpanRecorder } from "./spans.js";
export { type StaticContextTypeMode, staticUnderivableContextType } from "./static-config.js";
export type {
  CompileOptions,
  CompileResult,
  DerivationAnswer,
  DerivationRequest,
  NamedAccessor,
  ViewImport,
} from "./types.js";
export { compileView, type ViewOptions, type ViewResult } from "./view.js";
export {
  isTsiSpecifier,
  loweredVirtualNameFor,
  moduleIdFor,
  posixDirname,
  posixJoin,
  posixRelative,
  viewSourceCandidates,
  viewSourceSpecifierFor,
  viewSpecifierFor,
} from "./view-name.js";
