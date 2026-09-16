export { type AnswerContext, answerRequests, nodeAt } from "./answer.js";
export { derivationDiagnostics, type EditorDerivationDiagnostic } from "./diagnostics.js";
export { createDerivationService, type DerivationService, type DerivationServiceOptions } from "./service.js";
export { useTypeScript } from "./ts.js";
export { type ProjectConfig, readTsconfig } from "./tsconfig.js";
export {
  DerivationError,
  deriveType,
  type NamedAccessor,
  type ViewImport,
  type WalkContext,
  type WalkOutcome,
} from "./walk.js";
