export type { BabelNodeType, NodeType, NolaNodeType } from "./node-type.js";

import type { NodeType } from "./node-type.js";

export interface Position {
  /** 1-based */
  line: number;
  /** 0-based (Babel convention) */
  column: number;
}

export interface SourceLocation {
  start: Position;
  end: Position;
}

export interface BaseNode {
  type: NodeType;
  start: number;
  end: number;
  loc: SourceLocation;
  leadingComments?: CommentNode[] | null;
  [key: string]: unknown;
}

export interface CommentNode {
  type: "CommentBlock" | "CommentLine";
  value: string;
}

export interface TemplateElementNode extends BaseNode {
  type: "TemplateElement";
  value: { raw: string; cooked: string | null };
  tail: boolean;
}

export interface TemplateLiteralNode extends BaseNode {
  type: "TemplateLiteral";
  quasis: TemplateElementNode[];
  expressions: BaseNode[];
}

// ---------------------------------------------------------------------------
// Typed views over the Babel AST shapes Nola reads. Each carries only the
// fields the compiler consumes — they are narrowing targets for casts from
// BaseNode, not full @babel/types definitions. Fields are optional where
// tolerant-mode recovery (or a Babel version difference) may leave them
// absent; required fields match what the consuming code already assumed.
// ---------------------------------------------------------------------------

export interface IdentifierNode extends BaseNode {
  type: "Identifier";
  name: string;
}

export interface StringLiteralNode extends BaseNode {
  type: "StringLiteral";
  value: string;
}

export interface FileNode extends BaseNode {
  type: "File";
  program: BaseNode;
}

export interface ProgramNode extends BaseNode {
  type: "Program";
  body: BaseNode[];
}

export interface ExportNamedDeclarationNode extends BaseNode {
  type: "ExportNamedDeclaration";
  declaration?: BaseNode | null;
}

export interface ImportDeclarationNode extends BaseNode {
  type: "ImportDeclaration";
  source?: StringLiteralNode | null;
  specifiers?: BaseNode[];
}

export interface ImportSpecifierNode extends BaseNode {
  type: "ImportSpecifier";
  /** Identifier, or StringLiteral for `import { "a b" as x }` */
  imported?: IdentifierNode | StringLiteralNode;
  local?: IdentifierNode;
}

export interface CallExpressionNode extends BaseNode {
  type: "CallExpression";
  callee: BaseNode;
  arguments: BaseNode[];
}

export interface TaggedTemplateExpressionNode extends BaseNode {
  type: "TaggedTemplateExpression";
  tag: BaseNode;
  quasi: TemplateLiteralNode;
}

export interface ObjectExpressionNode extends BaseNode {
  type: "ObjectExpression";
  properties: BaseNode[];
}

export interface ObjectPropertyNode extends BaseNode {
  type: "ObjectProperty";
  key: BaseNode;
  value: BaseNode;
}

export interface ArrayExpressionNode extends BaseNode {
  type: "ArrayExpression";
  elements: Array<BaseNode | null>;
}

export interface AssignmentPatternNode extends BaseNode {
  type: "AssignmentPattern";
  left: BaseNode;
}

export interface TSTypeAnnotationNode extends BaseNode {
  type: "TSTypeAnnotation";
  typeAnnotation: BaseNode;
}

export interface TSTypeParameterInstantiationNode extends BaseNode {
  type: "TSTypeParameterInstantiation";
  params: BaseNode[];
}

export interface TSArrayTypeNode extends BaseNode {
  type: "TSArrayType";
  elementType: BaseNode;
}

export interface TSTypeLiteralNode extends BaseNode {
  type: "TSTypeLiteral";
  members?: BaseNode[];
}

export interface TSInterfaceBodyNode extends BaseNode {
  type: "TSInterfaceBody";
  body?: BaseNode[];
}

export interface TSInterfaceDeclarationNode extends BaseNode {
  type: "TSInterfaceDeclaration";
  id?: IdentifierNode | null;
  body?: TSInterfaceBodyNode | null;
  typeParameters?: BaseNode | null;
  extends?: BaseNode[] | null;
}

export interface TSTypeAliasDeclarationNode extends BaseNode {
  type: "TSTypeAliasDeclaration";
  id?: IdentifierNode | null;
  typeAnnotation: BaseNode;
  typeParameters?: BaseNode | null;
}

export interface TSEnumBodyNode extends BaseNode {
  type: "TSEnumBody";
  members?: BaseNode[];
}

export interface TSEnumDeclarationNode extends BaseNode {
  type: "TSEnumDeclaration";
  id?: IdentifierNode | null;
  /** Babel 8 nests members under `body` (TSEnumBody); older shapes have them inline. */
  body?: TSEnumBodyNode | null;
  members?: BaseNode[];
}

export interface TSEnumMemberNode extends BaseNode {
  type: "TSEnumMember";
  initializer?: BaseNode | null;
}

export interface TSUnionTypeNode extends BaseNode {
  type: "TSUnionType";
  types?: BaseNode[];
}

export interface TSLiteralTypeNode extends BaseNode {
  type: "TSLiteralType";
  literal?: BaseNode | null;
}

export interface TSQualifiedNameNode extends BaseNode {
  type: "TSQualifiedName";
  left: BaseNode;
  right: IdentifierNode;
}

export interface TSTypeReferenceNode extends BaseNode {
  type: "TSTypeReference";
  typeName?: IdentifierNode | TSQualifiedNameNode;
  /** Babel 7 spelling of the type-argument list. */
  typeParameters?: BaseNode | null;
  /** Babel 8 spelling of the type-argument list. */
  typeArguments?: BaseNode | null;
}

export interface TSPropertySignatureNode extends BaseNode {
  type: "TSPropertySignature";
  /** Identifier, or StringLiteral for a quoted key. */
  key?: IdentifierNode | StringLiteralNode;
  optional?: boolean;
  typeAnnotation?: TSTypeAnnotationNode | null;
}

export interface NolaExtractExpression extends BaseNode {
  type: "NolaExtractExpression";
  /** null only on a tolerant-mode recovery placeholder (see nolaError). */
  quasi: TemplateLiteralNode | null;
  /** cooked prompt text */
  prompt: string;
  /**
   * The written type: `` `p`<T> `` or, since the colon-typed spec (2026-09-23),
   * `` `p`: T `` — the parser wraps a colon type in the same one-param node
   * (spanning the colon to the type's end), so read `params[0]` either way.
   */
  typeArgs: TSTypeParameterInstantiationNode | null;
  /**
   * Set by the parser's tolerant-mode recovery: the construct was broken and a
   * diagnostic was recorded, so the lowering replaces its span with an inert
   * stand-in (its own bytes would leave a dot where the editor maps the cursor).
   */
  nolaError?: boolean;
}

export interface NolaAskExpression extends BaseNode {
  type: "NolaAskExpression";
  argument: BaseNode;
  /** `ask with <name>` provider alias; null on a plain `ask`. */
  provider: NolaProviderAlias | null;
}

/**
 * A context statement (spec 2026-09-29): an expression statement that is a
 * bare template literal, a chain of adjacent template literals, or text parts
 * and value parts (`` `analyze:` user `and report` ``). `parts` are in source
 * order and the first is always a TemplateLiteral; a value part is any
 * left-hand-side expression the parser admitted (a name chain, a call, a
 * bracketed literal, `new …`; a bare `this`, `await` or `ask` is NOLA1020).
 * The lowerer joins the parts into one `__nola.ctx` tagged template; a value
 * is never adjacent to another value.
 */
export interface NolaContextStatementNode extends BaseNode {
  type: "NolaContextStatement";
  parts: BaseNode[];
}

/**
 * The token span of a context statement's value part, as the parser consumed
 * it. Babel's node for a parenthesized expression spans the INNER expression
 * only (`extra.parenStart` names the `(`, nothing names the `)`), so the
 * lowerer reads this span — parentheses included — to know which bytes are
 * the value's own.
 */
export interface NolaContextValueNode extends BaseNode {
  nolaValueSpan?: { start: number; end: number };
}

/** Span + text of the provider alias in `ask with <name>`. */
export interface NolaProviderAlias {
  name: string;
  start: number;
  end: number;
}

/** A `FunctionDeclaration` node, plus the nola-specific fields the plugin attaches. */
export interface NolaFunctionNode extends BaseNode {
  /** span of the `infer` keyword (start = `infer`, end = start of `function`) */
  nolaInfer?: { start: number; end: number };
  nolaMarker?: NolaMarker;
  id?: { name?: string };
  params?: BaseNode[];
  body?: BaseNode;
  async?: boolean;
}

/**
 * Span + cooked text of the marker between an infer function's name and its
 * parameters. RESERVED since 2026-09-26 (NOLA1019, spec
 * 2026-09-26-body-instruction-only §3.1): the instruction is a context
 * statement in the body. Attached in tolerant mode only, so the lowering can
 * drop the bytes; strict mode never gets past the raise.
 */
export interface NolaMarker {
  start: number;
  end: number;
  /** cooked quasis joined (holes contribute nothing) */
  instruction: string;
  /** the marker literal, holes included */
  quasi?: TemplateLiteralNode;
}

/** A function parameter node, plus the span of a `..` contextual prefix if present. */
export interface NolaParamNode extends BaseNode {
  name?: string;
  typeAnnotation?: TSTypeAnnotationNode;
  /** span of the `..` prefix on an infer-function parameter */
  nolaContextual?: { start: number; end: number };
  /**
   * Tolerant-mode recovery placeholder: a `..` context parameter whose name has
   * not been typed yet. The node spans the marker alone; the lowering drops it.
   */
  nolaError?: boolean;
}

/**
 * A `VariableDeclarator` id, plus the span of a `.`/`..` marker the parser
 * found before it: `nolaContextual` for a legal contextual binding (`const .x`
 * / `let .x`), `nolaReservedMarker` for the reserved forms (`var .x`, a
 * pattern — NOLA1014 / NOLA1011), which exists only so tolerant lowering can
 * drop the bytes.
 */
export interface NolaVariableIdNode extends BaseNode {
  name?: string;
  /** `const .x` / `let .x` — the marker span of a contextual binding (scope-bodies spec §2.2) */
  nolaContextual?: { start: number; end: number };
  nolaReservedMarker?: { start: number; end: number };
}

export interface Diagnostic {
  code: string;
  message: string;
  file: string;
  start: number;
  end: number;
  loc: SourceLocation;
}

export const Codes = {
  ParseError: "NOLA1001",
  AskAsIdentifier: "NOLA1003",
  ReservedConstruct: "NOLA1004",
  ExpectedPrompt: "NOLA1005",
  InferWithoutFunction: "NOLA1006",
  MarkerOutsideInfer: "NOLA1007",
  ExpectedProviderName: "NOLA1009",
  ContextualParamOutsideInfer: "NOLA1010",
  ContextualParamReserved: "NOLA1011",
  IncompleteContextualParam: "NOLA1012",
  ContextualParamDoubleDot: "NOLA1013",
  ContextualBindingReserved: "NOLA1014",
  // NOLA1015 (IncompleteScopeAccess) retired with prompt templates (2026-09-28, instruction-interpolation spec): `${.member}` no longer parses.
  // NOLA1016 (UnknownExtractorKind) retired with the ..choice/..scale/..prob sugar (2026-09-23): an identifier after `..` is NOLA1005.
  AskTemplateNeedsSpace: "NOLA1017",
  ExpectedExtractorType: "NOLA1018",
  MarkerReserved: "NOLA1019",
  ContextValueTail: "NOLA1020",
  AskOutsideNolaFunction: "NOLA2001",
  UnsupportedIntentType: "NOLA2002",
  NolaFnNotTopLevel: "NOLA2003",
  UntypedCallIntentArg: "NOLA2004",
  // NOLA2006 (ReservedCompanionPath) retired with companions (emit 14): no reserved filename namespace remains.
  ViewUnavailable: "NOLA2007",
  UnderivableContextType: "NOLA2008",
  // NOLA2009 (ScopeAccessOutsideTemplate) retired with prompt templates (2026-09-28, instruction-interpolation spec): `${.member}` no longer parses.
  NolaConstructInMarker: "NOLA2010",
  TypeValueNameConflict: "NOLA2011",
  InvalidConstraint: "NOLA2012",
  // NOLA2013 (DuplicateInstruction) retired with the marker instruction (2026-09-26): the body literal is the only spelling; a marker is NOLA1019.
  ExtractorSigilRequired: "NOLA2014",
  InvalidDecisionCriteria: "NOLA2015",
  // NOLA2016 (LexicalHoleInInstruction) retired (2026-09-28, instruction-interpolation spec): a lexical hole is legal in every instruction literal.
  ContextOutsideScopeBody: "NOLA2017",
  // NOLA3xxx: runtime diagnostics
  EmitContractMismatch: "NOLA3001",
  DuplicateRuntimeConflict: "NOLA3002",
  ConfigInvalid: "NOLA3003",
  ConfigUnknownModel: "NOLA3004",
  ConfigReservedKey: "NOLA3005",
  CacheStoreInvalid: "NOLA3006",
  ReplayLedgerInvalid: "NOLA3007",
  ReplayFingerprintMismatch: "NOLA3008",
  SchemaUnsupported: "NOLA3009",
  IntentWithoutContext: "NOLA3010",
  IntentWithoutParentFrame: "NOLA3011",
  ConfigImportsTsi: "NOLA3012",
  BrowserExecutionUnsupported: "NOLA3013",
  // NOLA3014 (PromptTemplateFailed) retired with prompt templates (2026-09-28, instruction-interpolation spec): a throwing instruction thunk surfaces its own error.
  LoaderHooksUnsupported: "NOLA3015",
  ValidationFailed: "NOLA3016",
  SchemaTargetUnsupported: "NOLA3017",
  DecisionModelRequired: "NOLA3018",
  // NOLA4xxx: bundler-integration errors (build-time, raised by @nola-lang/unplugin and friends)
  TsiInClientBundle: "NOLA4001",
} as const;

export function isNode(v: unknown): v is BaseNode {
  return (
    typeof v === "object" &&
    v !== null &&
    typeof (v as { type?: unknown }).type === "string" &&
    typeof (v as { start?: unknown }).start === "number"
  );
}

export function children(node: BaseNode): BaseNode[] {
  const out: BaseNode[] = [];
  for (const key of Object.keys(node)) {
    if (key === "loc") continue;
    const value = node[key];
    if (Array.isArray(value)) {
      for (const item of value) if (isNode(item)) out.push(item);
    } else if (isNode(value)) {
      out.push(value);
    }
  }
  out.sort((a, b) => a.start - b.start);
  return out;
}

/** Top-level statements of a File or Program node; [] for anything else. */
export function programBody(ast: BaseNode): BaseNode[] {
  const program = ast.type === "File" ? (ast as FileNode).program : ast;
  return program.type === "Program" ? ((program as ProgramNode).body ?? []) : [];
}

export function walk(root: BaseNode, visit: (node: BaseNode, parent: BaseNode | null) => void): void {
  const queue: Array<{ node: BaseNode; parent: BaseNode | null }> = [{ node: root, parent: null }];
  while (queue.length > 0) {
    const item = queue.shift();
    if (!item) break;
    visit(item.node, item.parent);
    for (const child of children(item.node)) queue.push({ node: child, parent: item.node });
  }
}

export function sliceSpan(source: string, span: { start: number; end: number }): string {
  return source.slice(span.start, span.end);
}
