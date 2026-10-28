import {
  type ArrayExpressionNode,
  type AssignmentPatternNode,
  type BaseNode,
  type CallExpressionNode,
  Codes,
  children,
  type Diagnostic,
  type NolaAskExpression,
  type NolaContextStatementNode,
  type NolaContextValueNode,
  type NolaExtractExpression,
  type NolaFunctionNode,
  type NolaParamNode,
  type NolaToolListNode,
  type NolaVariableIdNode,
  type ObjectExpressionNode,
  type ObjectPropertyNode,
  type TaggedTemplateExpressionNode,
  type TemplateLiteralNode,
  walk,
} from "@nola-lang/ast";
import { toolWireName, type UnderivableContextTypeMode } from "@nola-lang/core";
import { collectDecisionTypeUses } from "../decision-imports.js";
import { collectExportedTypeNames, collectTopLevelValueNames, type ExportedTypeDecl } from "../schema.js";
import { accessorNameFor } from "../schema-expr.js";
import { anchorInsertedLines, type EditAnchor, type Span, SpanRecorder } from "../spans.js";
import type { CompileResult, DerivationRequest, ViewInlineOptions } from "../types.js";
import {
  ASK_OPEN,
  askClose,
  askSiteArg,
  BROKEN_CONSTRUCT,
  CALL_INTENT_CLOSE,
  CONTEXT_ITEM_CLOSE,
  callIntentArgsHead,
  callIntentOpen,
  callIntentTypeText,
  contextItemName,
  contextItemOpen,
  defHash,
  EXTRACT_DEFAULT_TYPE_EXPR,
  EXTRACT_DEFAULT_TYPE_TEXT,
  extractClose,
  extractOpen,
  FMT_CLOSE,
  FMT_OPEN,
  FRAME_PARAM,
  FUNC_PART_CLOSE,
  FUNC_PART_OPEN,
  funcPartArgsHead,
  INERT_ACCESSOR_BODY,
  inertAccessorDecl,
  invocationArgEntry,
  invocationClose,
  invocationOpen,
  locText,
  MODULE_SCOPE_CALL,
  OBJ_PART_OPEN,
  objPartClose,
  rawTemplateText,
  runtimeImport,
  SEQ_PART_SEP,
  SEQUENCE_CLASS,
  sequenceClose,
  sequenceOpen,
  siteAccessorName,
  TEXT_JOIN_HOLE,
  TOOLS_OPEN,
  TOOLS_PART_CLOSE,
  TOOLS_PART_OPEN,
  templateCopy,
  toolAccessorDecl,
  toolAccessorName,
  toolSourceClose,
  toolSourceOpen,
  toolUseClose,
  toolUseOpen,
  typeArgsText,
  typeValueDecl,
  typeValueText,
} from "./templates.js";

/** The scope body a node sits directly in (scope-bodies spec §5.1); "none" is where `ask` is illegal. */
type AskBody = "infer" | "module" | "none";

/** An identifier or a dotted chain of identifiers (`fs.promises.readFile`): the written text can name a tool or prefix a group. */
function isNameChain(node: BaseNode): boolean {
  if (node.type === "Identifier") return true;
  if (node.type !== "MemberExpression") return false;
  const m = node as unknown as { computed: boolean; object: BaseNode; property: BaseNode };
  return !m.computed && m.property.type === "Identifier" && isNameChain(m.object);
}

/**
 * A side-effect-free object expression: a name, `this`, or dotted / indexed /
 * optional access over one with identifier or literal keys. Evaluating it a
 * second time is harmless, so it can ride as a method's receiver (spec
 * 2026-10-09 §1.6).
 */
function isPureChain(node: BaseNode): boolean {
  if (node.type === "Identifier" || node.type === "ThisExpression") return true;
  if (node.type !== "MemberExpression" && node.type !== "OptionalMemberExpression") return false;
  const m = node as unknown as { computed: boolean; object: BaseNode; property: BaseNode };
  const key = m.property;
  const pureKey = m.computed
    ? key.type === "Identifier" || key.type === "StringLiteral" || key.type === "NumericLiteral" || isPureChain(key)
    : key.type === "Identifier";
  return pureKey && isPureChain(m.object);
}

/** A hole holding the tolerant placeholder of a stray `${.` mid-typing — its bytes are not TypeScript. */
const isPlaceholderHole = (expr: BaseNode) =>
  expr.type === "NolaExtractExpression" && (expr as NolaExtractExpression).nolaError === true;

/**
 * Statements whose body may be a single statement instead of a block. A
 * context statement there (`if (x) `…``) has no block for its item to be
 * visible in, and the function declaration it lowers to is illegal there in
 * strict code — NOLA2017, like a context statement outside a scope body.
 */
const UNBRACED_BODY_PARENTS: ReadonlySet<string> = new Set([
  "IfStatement",
  "ForStatement",
  "ForInStatement",
  "ForOfStatement",
  "WhileStatement",
  "DoWhileStatement",
  "LabeledStatement",
  "WithStatement",
]);

/**
 * One scope body being lowered (an infer body or the module body): the static
 * half of its contextual bindings — the `locals: [{ name, type? }]` entries of
 * its scope init — and the block-scope stack that decides which bindings and
 * context items an ask can see (declared before it, in its block or an
 * enclosing one — spec 2026-09-29 decision 4).
 */
interface BodyRecord {
  localEntries: string[];
  scopes: Array<{ locals: string[]; items: string[] }>;
}

/** A request whose lowered range is resolved once the span tiling exists (end of run()). */
interface PendingRequest extends Omit<DerivationRequest, "lowered"> {
  lowered?: DerivationRequest["lowered"];
}

/** What a part of an ask sequence is by its syntax (spec 2026-10-12 §1.1). */
type PartKind = "text" | "obj" | "tools" | "func";

/** A classified sequence: the row of the kind table (§1.2) and each part with its kind, in source order. */
interface ClassifiedParts {
  kind: "extract" | "call" | "tool-use";
  parts: Array<{ kind: PartKind; node: BaseNode }>;
}

/** What an earlier list of the ask emitted for a written entry — re-emitted where the entry is written again, under the same accessor (spec 2026-10-12 §3.4). */
interface EmittedEntry {
  accessor: string;
  spread: boolean;
  writtenName?: string;
  receiver?: string;
}

/**
 * Phase 1 of the two-phase compile (checker-backed derivation, emit 15): every
 * derivation site — exported type, extractor `<T>`, parameter annotation —
 * becomes a call to an appendix accessor whose body is INERT here; the
 * checker fills the bodies in through finalizeDerivations. This class never
 * derives a schema itself: it records where each type node sits in the source
 * and in the lowered text, and nothing else about the type.
 */
export class Lowerer {
  private readonly s: SpanRecorder;
  private readonly source: string;
  /** Absolute on-disk path. Diagnostics and source maps use this. */
  private readonly file: string;
  /** Project-root-relative path. Only this reaches the emitted code. */
  private readonly displayFile: string;
  private readonly ast: BaseNode;
  private readonly diagnostics: Diagnostic[] = [];
  private readonly meta: { nolaFunctions: string[] } = { nolaFunctions: [] };
  private usedRuntime = false;
  /**
   * Where the node being visited lives: "context" — inside a context
   * statement (a value, or a hole of a text part): `ask` and a bare extractor
   * have no frame there — NOLA2010 — while a call intent is a value like any
   * other (a HINTED one, `fn`hint`(…)`, must be parenthesized or sit in a
   * hole: bare, its backtick reads as the next text part and the extractor
   * argument lands here as a parenthesized bare extractor); "copy" — a call
   * hint re-emitted from source bytes into the args head, where a Nola
   * construct has nowhere to lower to (NOLA2010) and a tolerant placeholder
   * was already replaced by the copy, so it is left alone. NOTHING inside a
   * copy is edited — the copy overwrote those bytes and magic-string cannot
   * split an edited chunk — so every construct there is only diagnosed (a
   * `.x` binding in a callback keeps its NOLA1010); "none" — neither.
   */
  private holeSite: "none" | "context" | "copy" = "none";
  /** derivation requests in declaration order: site accessors as met, exported types last */
  private readonly requests: PendingRequest[] = [];
  private siteCounter = 0;
  /** file-wide counter behind `__nola_ctx_N` — module and body items alike, source order */
  private itemCounter = 0;
  /** the module body's TOP-LEVEL context items met so far, by name: the init's canonical list and each later function's view */
  private readonly moduleItems: string[] = [];
  /**
   * whether every context statement in the file is an item (a pre-scan): the
   * module body asks, the file declares an infer function, or a context
   * statement has two or more parts — never valid JavaScript alone
   */
  private scopeUsers = false;
  /** context statements that are the unbraced body of an `if`, a loop, a label or a `with` (the same pre-scan) — NOLA2017 */
  private readonly unbracedStatements = new Set<BaseNode>();
  /** the scope bodies being lowered, innermost last; the module body is the bottom entry */
  private readonly bodies: BodyRecord[] = [];
  /** exported alias/interface/enum declarations (spec §1: every alias/interface also becomes a value) */
  private readonly exportedTypes: ExportedTypeDecl[];
  /** policy for underivable `.`-contextual param types (compiler.underivableContextType) */
  private readonly underivableContextType: UnderivableContextTypeMode;

  constructor(
    source: string,
    file: string,
    ast: BaseNode,
    displayFile: string,
    options: { underivableContextType?: UnderivableContextTypeMode; views?: ViewInlineOptions } = {},
  ) {
    this.s = new SpanRecorder(source);
    this.source = source;
    this.file = file;
    this.displayFile = displayFile;
    this.ast = ast;
    this.underivableContextType = options.underivableContextType ?? "error";
    this.exportedTypes = collectExportedTypeNames(ast);
  }

  run(): CompileResult {
    // Whether the file's context statements are items (spec 2026-09-29 §3.3,
    // amended): the module body asks, the file declares an infer function, or a
    // statement has two or more parts (alone a chain throws and a value does
    // not parse). Known BEFORE the walk, so every item lowers in place as it is
    // met; a file with none of these keeps its lone text statements
    // byte-identical (see lowerContextStatement).
    walk(this.ast, (n, parent) => {
      if (
        n.type === "NolaAskExpression" ||
        (n.type === "FunctionDeclaration" && (n as NolaFunctionNode).nolaInfer) ||
        (n.type === "NolaContextStatement" && (n as NolaContextStatementNode).parts.length > 1)
      ) {
        this.scopeUsers = true;
      }
      if (n.type === "NolaContextStatement" && parent !== null && UNBRACED_BODY_PARENTS.has(parent.type)) {
        this.unbracedStatements.add(n);
      }
    });
    const moduleBody: BodyRecord = { localEntries: [], scopes: [{ locals: [], items: [] }] };
    this.bodies.push(moduleBody);
    this.visit(this.ast, "module", true);
    this.bodies.pop();
    this.emitTypeValues();

    // intrinsic decision types (spec 2026-09-18 §2.1): the appendix imports the
    // names the file uses and does not declare — which needs the appendix at all
    const decisionTypes = collectDecisionTypeUses(this.ast);
    if (decisionTypes.length > 0) this.usedRuntime = true;

    let accessorsStart = -1;
    if (this.usedRuntime) {
      let appendix = runtimeImport(this.displayFile, { itemNames: this.moduleItems, localEntries: moduleBody.localEntries }, decisionTypes);
      accessorsStart = appendix.length;
      for (const r of this.requests) {
        appendix +=
          r.kind === "tool"
            ? toolAccessorDecl(r.accessor, INERT_ACCESSOR_BODY)
            : inertAccessorDecl(r.accessor, r.kind === "context" || r.kind === "value");
      }
      this.s.appendix(appendix);
    }

    const map = this.s.generateMap({ source: this.file, hires: true, includeContent: true });
    const { spans, anchors } = this.s.finalize(this.source.length);
    const code = this.s.toString();
    anchorInsertedLines(map, spans, code, this.source);

    const appendixSpan = spans[spans.length - 1];
    const appendixStart =
      accessorsStart >= 0 && appendixSpan?.kind === "appendix" ? appendixSpan.generatedStart + accessorsStart : -1;
    const derivations = this.requests.map((r) => ({
      ...r,
      lowered: r.lowered ?? this.loweredRange(r, spans, anchors),
    }));

    return {
      code,
      map,
      diagnostics: this.diagnostics,
      meta: { ...this.meta, spans, anchors, views: [], mode: "lowered", derivations, appendixStart },
    };
  }

  /**
   * Where a request's type node sits in the lowered text. An extractor's `<T>`
   * is copied into the opener as an ANCHOR (the generated copy of the source
   * range); a declaration name or a parameter annotation is untouched source,
   * so it lies inside a verbatim span at a fixed offset from the span start.
   */
  private loweredRange(
    r: PendingRequest,
    spans: Span[],
    anchors: Array<{ sourceStart: number; sourceEnd: number; generatedStart: number; generatedEnd: number }>,
  ): DerivationRequest["lowered"] {
    const { start, end } = r.source;
    if (r.kind === "extract" || r.kind === "tool") {
      const a = anchors.find((x) => x.sourceStart === start && x.sourceEnd === end);
      if (a) return { start: a.generatedStart, end: a.generatedEnd };
    }
    const sp = spans.find((x) => x.kind === "verbatim" && x.sourceStart <= start && end <= x.sourceEnd);
    if (!sp) throw new Error(`lowerer: no verbatim span for ${r.kind} request ${r.accessor} at ${start}-${end}`);
    const delta = sp.generatedStart - sp.sourceStart;
    return { start: start + delta, end: end + delta };
  }

  private request(kind: DerivationRequest["kind"], node: BaseNode, extra: Partial<PendingRequest> = {}): string {
    const accessor = extra.accessor ?? (kind === "tool" ? toolAccessorName(++this.siteCounter) : siteAccessorName(++this.siteCounter));
    this.requests.push({ accessor, kind, source: { start: node.start, end: node.end, loc: node.loc }, ...extra });
    this.usedRuntime = true;
    return accessor;
  }

  /**
   * Spec §1: every exported type alias / interface also exports a value under
   * its own name. Enums are already values. The accessor is the same one an
   * extractor referencing the type would call (one definition per name).
   */
  private emitTypeValues(): void {
    const values = collectTopLevelValueNames(this.ast);
    for (const decl of this.exportedTypes) {
      if (decl.kind === "enum") continue;
      if (values.has(decl.name)) {
        this.diag(
          Codes.TypeValueNameConflict,
          `exported type '${decl.name}' would also become a value, but a value named '${decl.name}' is already declared in this file — rename one of them.`,
          decl.node,
        );
        continue;
      }
      const id = (decl.node as { id?: BaseNode }).id ?? decl.node;
      this.request("exported", id, { accessor: accessorNameFor(decl.name), name: decl.name });
      this.s.appendLeft(decl.statement.end, typeValueDecl(decl.name, typeValueText(decl.name)));
    }
  }

  private diag(code: string, message: string, node: BaseNode): void {
    this.diagnostics.push({ code, message, file: this.file, start: node.start, end: node.end, loc: node.loc });
  }

  // body: the scope body the node sits DIRECTLY in — where `ask` (an await) is
  // legal. "module" from Program, "infer" inside an infer function's body,
  // "none" through every function scope and class member that resets it.
  // topLevel: current node is a direct child of Program (or an export wrapper).
  private visit(node: BaseNode, body: AskBody, topLevel: boolean): void {
    switch (node.type) {
      case "NolaExtractExpression": {
        const extract = node as NolaExtractExpression;
        // Tolerant-parse placeholder: the diagnostic is already recorded, so
        // this only has to keep the generated text sane for the editor. The
        // marker's own bytes would otherwise leave a dot at the cursor and TS
        // would answer the next `.`-triggered completion with the global scope.
        // A stray `${.` inside an instruction hole lands here too — never
        // NOLA2010: a copied call hint already replaced it (templateCopy), an
        // in-place literal replaces it now.
        if (extract.nolaError || !extract.quasi) {
          if (this.holeSite === "copy") return;
          // The end-of-file placeholder is zero-width (an expression that was
          // never typed): there are no bytes to overwrite, so the inert text
          // is inserted at its position instead.
          if (node.start === node.end) this.s.appendLeft(node.start, BROKEN_CONSTRUCT, { broken: true });
          else this.s.overwrite(node.start, node.end, BROKEN_CONSTRUCT, { broken: true });
          return;
        }
        if (this.holeSite !== "none") {
          this.diagCopiedHole(node);
          return;
        }
        this.lowerExtract(extract, body);
        return;
      }
      case "TSInstantiationExpression": {
        // `` `x`<T> `` is an extractor only directly after `ask` or in a call's
        // slots (the parser claims both); anywhere else TypeScript rejects type
        // args on a non-generic expression. Say what the author meant instead
        // of leaving that to TS2635.
        if ((node as unknown as { expression: BaseNode }).expression.type === "TemplateLiteral") {
          this.diag(
            Codes.ExtractorSigilRequired,
            "a typed template literal is an extractor only directly after `ask` or in a call's argument list; write ..`…`<T> here.",
            node,
          );
        }
        break;
      }
      case "NolaAskExpression": {
        if (this.holeSite !== "none") {
          this.diagCopiedHole(node);
          return;
        }
        const ask = node as NolaAskExpression;
        // Text after a bare call parses as a template tagged by the call; the
        // words go first (spec 2026-10-12 §1.1).
        const operand = ask.argument;
        if (
          operand.type === "TaggedTemplateExpression" &&
          this.isCallIntentCall((operand as TaggedTemplateExpressionNode).tag as BaseNode)
        ) {
          this.diag(Codes.AskSequenceInvalid, "put the words before the call: `ask `words` fn(…)`.", operand);
        }
        if (body === "none") {
          this.diag(
            Codes.AskOutsideNolaFunction,
            "`ask` is only allowed directly inside an infer function body or the module body.",
            node,
          );
        } else {
          // Overwriting up to the operand also removes an `with <alias>` span;
          // the alias re-enters as ask's third argument.
          // `ask` and the whitespace up to its operand — the operand may start on the next line
          this.s.overwrite(node.start, ask.argument.start, ASK_OPEN + this.lineTerminatorsIn(node.start, ask.argument.start));
          // appendRight: extract-lowering suffixes use appendLeft at the same
          // position and must land BEFORE this closing paren.
          // An infer body threads the frame its wrapper minted; the module body
          // has no wrapper, so it hands over its scope node and the runtime
          // opens the frame.
          const scope = body === "infer" ? FRAME_PARAM : MODULE_SCOPE_CALL;
          this.s.appendRight(node.end, askClose(scope, askSiteArg(ask.provider?.name, this.visibleLocals(), this.visibleItems())));
          this.usedRuntime = true;
        }
        this.visit(ask.argument, body, false);
        return;
      }
      case "FunctionDeclaration": {
        const fn = node as NolaFunctionNode;
        if (!fn.nolaInfer) {
          break;
        }

        if (!topLevel) {
          // TODO: to discuss - wew should not have this limitation
          this.diag(Codes.NolaFnNotTopLevel, "infer functions must be declared at module top level.", node);
          break;
        }

        this.bodies.push({ localEntries: [], scopes: [{ locals: [], items: [] }] });
        this.lowerInferFunction(fn);
        this.bodies.pop();
        return;
      }
      case "CallExpression": {
        const call = node as CallExpressionNode;
        // The tagged form, or the sigil-less one: extractor args imply the
        // call intent. Simple callees only — `new`, optional calls, super(),
        // and exotic callees (call results, parenthesized exprs) stay plain
        // calls; the sigil form keeps its wider callee latitude.
        if (!this.isCallIntentCall(node)) break;
        if (this.holeSite === "copy") {
          this.diagCopiedHole(node);
          return;
        }
        this.lowerCallIntent(call, body);
        return;
      }
      case "NolaContextStatement": {
        this.lowerContextStatement(node as NolaContextStatementNode, body);
        return;
      }
      case "VariableDeclarator": {
        const id = (node as { id?: NolaVariableIdNode }).id;
        // Reserved forms (`var .x`, a pattern — NOLA1014 / NOLA1011): the
        // parser kept the declarator and parked the marker span on its id.
        // Strict mode never gets here (raise throws); in tolerant mode the dot
        // must not reach the generated TS, and `broken` opts the cursor
        // position out of completion exactly as the parameter marker does.
        if (id?.nolaReservedMarker) {
          // Inside a call hint's hole the hint's copy already replaced these bytes.
          if (this.holeSite !== "copy") {
            this.s.overwrite(id.nolaReservedMarker.start, id.nolaReservedMarker.end, "", { broken: true });
          }
          break;
        }
        if (id?.nolaContextual) {
          this.lowerContextualBinding(node, id, id.nolaContextual, body);
          return;
        }
        break;
      }
      case "BlockStatement":
      case "ForStatement":
      case "ForInStatement":
      case "ForOfStatement":
      case "SwitchStatement": {
        // A block scope: bindings declared inside it are visible to asks
        // inside it (a for-head's binding to the loop body) and to nothing after.
        const current = this.bodies[this.bodies.length - 1];
        if (current === undefined || body === "none") break;
        current.scopes.push({ locals: [], items: [] });
        try {
          for (const child of children(node)) this.visit(child, body, false);
        } finally {
          current.scopes.pop();
        }
        return;
      }
      default:
        break;
    }
    const isFunctionScope =
      node.type === "FunctionDeclaration" ||
      node.type === "FunctionExpression" ||
      node.type === "ArrowFunctionExpression" ||
      node.type === "ObjectMethod" ||
      node.type === "ClassMethod" ||
      node.type === "ClassPrivateMethod" ||
      // `await` is illegal in a field initializer, a static block and a namespace body.
      node.type === "ClassProperty" ||
      node.type === "ClassPrivateProperty" ||
      node.type === "ClassAccessorProperty" ||
      node.type === "StaticBlock" ||
      node.type === "TSModuleBlock";
    const nextTopLevel =
      node.type === "File" ||
      node.type === "Program" ||
      (topLevel && (node.type === "ExportNamedDeclaration" || node.type === "ExportDefaultDeclaration"));
    for (const child of children(node)) {
      this.visit(child, isFunctionScope ? "none" : body, nextTopLevel);
    }
  }

  /** The contextual bindings an ask at this point can see, in declaration order. */
  private visibleLocals(): string[] {
    const current = this.bodies[this.bodies.length - 1];
    return current ? current.scopes.flatMap((s) => s.locals) : [];
  }

  /** The context items an ask at this point can see, in source order (spec 2026-09-29 decision 4). */
  private visibleItems(): string[] {
    const current = this.bodies[this.bodies.length - 1];
    return current ? current.scopes.flatMap((s) => s.items) : [];
  }

  /**
   * A context statement (spec 2026-09-29 §3.3), lowered in place: the opener
   * before the first backtick, every seam between parts rewritten into a hole
   * boundary, `; }` over a glued `;` or appended after the last part. The
   * text and value bytes never move (verbatim spans, so completion, hover and
   * TS errors work inside a value) and no line terminator is added or lost:
   * the whitespace between parts is re-emitted as written, comments dropped.
   * Outside a scope body no frame can carry it — NOLA2017, the bytes become the
   * inert text under a `broken` span (a callback inside an infer body too).
   */
  private lowerContextStatement(node: NolaContextStatementNode, body: AskBody): void {
    const current = this.bodies[this.bodies.length - 1];
    const unbraced = this.unbracedStatements.has(node);
    if (body === "none" || current === undefined || unbraced) {
      this.diag(
        Codes.ContextOutsideScopeBody,
        unbraced
          ? "a context statement cannot be the unbraced body of an `if`, a loop or a label — wrap it in braces."
          : "a context statement is only legal in a scope body — directly in an infer function or at module level.",
        node,
      );
      // Inside a call hint's hole the hint's copy already replaced these bytes.
      if (this.holeSite === "copy") return;
      const terminators = this.source.slice(node.start, node.end).replace(/[^\r\n]/g, "");
      this.s.overwrite(node.start, node.end, `${BROKEN_CONSTRUCT};${terminators}`, { broken: true });
      return;
    }
    // A value's own bytes, parentheses included — the parser's span (a Babel
    // node for `(x)` spans `x` alone). The parser sets it on every value and on
    // no text part, which is also what tells text from a parenthesized template
    // VALUE (`` `a` (`b`) ``, a TemplateLiteral too); the fallback only types.
    const valueSpan = (p: BaseNode) => (p as NolaContextValueNode).nolaValueSpan;
    const isText = (p: BaseNode) => p.type === "TemplateLiteral" && valueSpan(p) === undefined;
    const span = (p: BaseNode) => valueSpan(p) ?? { start: p.start, end: p.end };
    const parts = node.parts;
    // A file with no scope user has only lone text statements (a statement of
    // two or more parts makes the file one — run()'s pre-scan): plain JS, a
    // no-op, kept byte-identical; its holes still follow the rules below.
    if (body === "module" && !this.scopeUsers) {
      this.visitContextParts(parts, isText);
      return;
    }
    const name = contextItemName(++this.itemCounter);
    // A RIGHT-side insert: a left-side insert at this offset belongs to the
    // statement before — an exported type's value declaration, added after the
    // walk — and must stay in front of the item; the wrapper opener at `{` is
    // left-side too. Nothing overwrites from here: the opening backtick stays.
    this.s.appendRight(node.start, contextItemOpen(name));
    for (let i = 0; i + 1 < parts.length; i++) {
      const a = parts[i] as BaseNode;
      const b = parts[i + 1] as BaseNode;
      const aEnd = isText(a) ? a.end : span(a).end;
      const bStart = isText(b) ? b.start : span(b).start;
      const ws = this.gapText(aEnd, bStart);
      if (isText(a) && isText(b)) this.s.overwrite(a.end - 1, b.start + 1, ws === "" && this.gluedHole(a, b) ? TEXT_JOIN_HOLE : ws);
      else if (isText(a)) this.s.overwrite(a.end - 1, bStart, `${ws}\${`);
      else this.s.overwrite(aEnd, b.start + 1, `}${ws}`);
    }
    this.visitContextParts(parts, isText);
    // The closers go in after the values: a value's own lowering may overwrite
    // its last bytes (a call intent's `)`), and magic-string drops whatever was
    // appended to a chunk it overwrites later.
    const last = parts[parts.length - 1] as BaseNode;
    const lastEnd = isText(last) ? last.end : span(last).end;
    if (!isText(last)) this.s.appendLeft(lastEnd, "}`");
    if (this.source.slice(lastEnd, node.end) === ";") this.s.overwrite(lastEnd, node.end, CONTEXT_ITEM_CLOSE);
    else this.s.appendLeft(lastEnd, CONTEXT_ITEM_CLOSE);
    (current.scopes[current.scopes.length - 1] as { items: string[] }).items.push(name);
    if (body === "module" && current.scopes.length === 1) this.moduleItems.push(name);
    this.usedRuntime = true;
  }

  /**
   * A context statement's values and text holes: a call intent lowers (its
   * arguments are its own slots); `ask` and a bare extractor are NOLA2010 —
   * there is no frame here.
   */
  private visitContextParts(parts: readonly BaseNode[], isText: (p: BaseNode) => boolean): void {
    const prevSite = this.holeSite;
    this.holeSite = "context";
    try {
      for (const part of parts) {
        if (isText(part)) {
          for (const expr of (part as TemplateLiteralNode).expressions) this.visit(expr, "none", false);
        } else {
          this.visit(part, "none", false);
        }
      }
    } finally {
      this.holeSite = prevSite;
    }
  }

  /** The bytes between two parts with comments dropped and every line terminator kept — what a seam re-emits. */
  private gapText(start: number, end: number): string {
    return this.source.slice(start, end).replace(/\/\*[\s\S]*?\*\/|\/\/[^\r\n]*/g, (m) => m.replace(/[^\r\n]/g, ""));
  }

  /** Two glued texts would open a hole: the left ends with an unescaped `$`, the right starts with `{`. */
  private gluedHole(left: BaseNode, right: BaseNode): boolean {
    if (this.source[left.end - 2] !== "$" || this.source[right.start + 1] !== "{") return false;
    let slashes = 0;
    while (this.source[left.end - 3 - slashes] === "\\") slashes++;
    return slashes % 2 === 0;
  }

  /**
   * `const .x` / `let .x` (scope-bodies spec §2.2). Legal directly in a scope
   * body: the marker goes (a replaced span — the binding is not broken, so
   * the editor keeps completing after it), an annotation becomes a context
   * derivation request under the configured policy, and the name enters the
   * body's scope init and the current block scope — AFTER its initializer is
   * visited, so `const .bio = ask ..\`bio\`` never lists itself.
   */
  private lowerContextualBinding(
    node: BaseNode,
    id: NolaVariableIdNode,
    marker: { start: number; end: number },
    body: AskBody,
  ): void {
    const current = this.bodies[this.bodies.length - 1];
    if (body === "none" || current === undefined) {
      this.diag(
        Codes.ContextualParamOutsideInfer,
        "`.` contextual markers are only allowed on infer function parameters and on bindings directly in an infer body or the module body.",
        id,
      );
      // Inside a call hint's hole the hint's copy already replaced these bytes.
      if (this.holeSite !== "copy") this.s.overwrite(marker.start, marker.end, "", { broken: true });
      for (const child of children(node)) this.visit(child, body, false);
      return;
    }
    this.s.overwrite(marker.start, marker.end, "");
    let typeExpr: string | undefined;
    const tsAnn = (id as { typeAnnotation?: { typeAnnotation?: BaseNode } }).typeAnnotation?.typeAnnotation;
    if (tsAnn) typeExpr = `${this.request("context", tsAnn, { policy: this.underivableContextType })}()`;
    for (const child of children(node)) this.visit(child, body, false);
    const name = id.name ?? "";
    current.localEntries.push(invocationArgEntry(name, typeExpr, false));
    (current.scopes[current.scopes.length - 1] as { locals: string[] }).locals.push(name);
  }

  /** A call that is a call intent: the hinted form, or a simple callee with a typed slot (the sigil-less rule). */
  private isCallIntentCall(node: BaseNode): boolean {
    if (node.type !== "CallExpression") return false;
    const call = node as CallExpressionNode;
    if (call.callee.type === "TaggedTemplateExpression") return true;
    return (
      (call.callee.type === "Identifier" || call.callee.type === "MemberExpression") &&
      call.arguments.some((a) => this.hasExtractorSlot(a as BaseNode))
    );
  }

  /** The row of the table (spec 2026-10-12 §1.2) for a sequence, or undefined after the diagnostic that refuses it. */
  private classifyParts(node: NolaExtractExpression): ClassifiedParts | undefined {
    const parts = node.parts.map((p) => ({ node: p, kind: this.partKind(p) }));
    const lists = parts.filter((p) => p.kind === "tools").length;
    const calls = parts.filter((p) => p.kind === "func");
    if (calls.length > 1) {
      this.diag(Codes.AskSequenceInvalid, "an ask makes one call — split the asks.", calls[1]?.node as BaseNode);
      return undefined;
    }
    if (lists > 0 && calls.length === 1) {
      this.diag(
        Codes.AskSequenceReserved,
        "offering tools beside a call is reserved for a future Nola version — offer the function as a tool, `[createUser]`, or make the call a separate ask.",
        calls[0]?.node as BaseNode,
      );
      return undefined;
    }
    if (calls.length === 1 && node.typeArgs) {
      this.diag(Codes.AskSequenceInvalid, "a call intent's result type is its callee's — drop `: T`.", node.typeArgs);
      return undefined;
    }
    for (const p of parts) {
      if (p.kind === "obj" && this.containsCallIntent(p.node)) {
        this.diag(
          Codes.AskSequenceInvalid,
          "a call with typed slots is the ask's action, not data — write it bare between texts: `ask `words` fn(`slot`: T)`.",
          p.node,
        );
        return undefined;
      }
    }
    return { kind: calls.length === 1 ? "call" : lists > 0 ? "tool-use" : "extract", parts };
  }

  /** What a part is by its syntax (spec §1.1): text, a list, a call part (a bare, simple call with a typed slot), else data. */
  private partKind(p: BaseNode): PartKind {
    if (p.type === "TemplateLiteral") return "text";
    if (p.type === "NolaToolList") return "tools";
    const parenthesized = Boolean((p as { extra?: { parenthesized?: boolean } }).extra?.parenthesized);
    if (p.type === "CallExpression" && !parenthesized) {
      const call = p as CallExpressionNode;
      if (
        (call.callee.type === "Identifier" || call.callee.type === "MemberExpression") &&
        call.arguments.some((a) => this.hasExtractorSlot(a as BaseNode))
      ) {
        return "func";
      }
    }
    return "obj";
  }

  /** A call intent anywhere inside a value, outside a nested ask — the action written as data. */
  private containsCallIntent(node: BaseNode): boolean {
    const visit = (n: BaseNode): boolean => {
      if (n.type === "NolaAskExpression") return false;
      if (this.isCallIntentCall(n)) return true;
      return children(n).some(visit);
    };
    return visit(node);
  }

  /**
   * Sigil-less call-intent detection (2026-08-14 spec): a well-formed extractor
   * in a slot position — a direct argument, or nested at any depth inside plain
   * object/array literals (the same walk checkCallIntentArg performs). Tolerant
   * placeholders (nolaError) do NOT count: a half-typed `f(..` stays a plain
   * call, so the editor never lowers a call intent around a broken slot. An
   * EMPTY argument — `f(, 1)` mid-edit — is the null Babel's recovery leaves
   * in `arguments` (a recoverable raise at the comma, never a node): not a
   * slot either. This runs on every call in the file, so a throw here took
   * the language server down (2026-10-13).
   */
  private hasExtractorSlot(node: BaseNode | null | undefined): boolean {
    if (!node) return false;
    if (node.type === "NolaExtractExpression") {
      return !(node as NolaExtractExpression).nolaError;
    }

    if (node.type === "ObjectExpression") {
      return (node as ObjectExpressionNode).properties.some(
        (p) => p.type === "ObjectProperty" && this.hasExtractorSlot((p as ObjectPropertyNode).value),
      );
    }

    if (node.type === "ArrayExpression") {
      return (node as ArrayExpressionNode).elements.some((el) => el != null && this.hasExtractorSlot(el));
    }

    return false;
  }

  private diagCopiedHole(node: BaseNode): void {
    this.diag(
      Codes.NolaConstructInMarker,
      "Nola constructs are not allowed inside a context statement or an instruction literal's hole; a hinted call intent used as a value must be parenthesized.",
      node,
    );
  }

  /**
   * The instruction field of a call hint — the one literal whose bytes cannot
   * stay where they are (the callee's `(` follows it): prose → JSON string;
   * holes → a template literal with fmt-wrapped holes, copied into the args
   * head with anchors pointing back at the literal's verbatim runs.
   */
  private instructionFieldFor(
    quasi: TemplateLiteralNode,
    cooked: string,
  ): { field: string; copyText: string; anchors: EditAnchor[]; holes: BaseNode[] } {
    if (quasi.expressions.length === 0) return { field: JSON.stringify(cooked), copyText: "", anchors: [], holes: [] };
    const copy = templateCopy(this.source, quasi, quasi.expressions.filter(isPlaceholderHole));
    return { field: copy.text, copyText: copy.text, anchors: copy.anchors, holes: quasi.expressions };
  }

  /** Visit the holes of a copied call hint only to diagnose (NOLA2010) — the copy is already built. */
  private visitCopiedHoles(holes: BaseNode[], body: AskBody): void {
    const prevSite = this.holeSite;
    this.holeSite = "copy";
    try {
      for (const e of holes) this.visit(e, body, false);
    } finally {
      this.holeSite = prevSite;
    }
  }

  /**
   * Drops a source range's bytes but keeps every line terminator in it, so
   * nothing after it moves. The debugger layout invariant (2026-09-17): js-debug
   * binds a `.tsi` breakpoint raw by URL + line on the lowered script as well
   * as through the map, so a removed multi-line literal — a prose module or
   * body instruction — shifted every later statement up and the raw
   * copy of a breakpoint on the ask line landed on the statement after it.
   */
  private removeKeepingLines(start: number, end: number): void {
    const terminators = this.source.slice(start, end).replace(/[^\r\n]/g, "");
    if (terminators.length === 0) this.s.remove(start, end);
    else this.s.overwrite(start, end, terminators);
  }

  private lowerInferFunction(fn: NolaFunctionNode): void {
    const infer = fn.nolaInfer;
    if (!infer) return;
    const name = fn.id?.name ?? "anonymous";
    // Removes `infer ` including trailing whitespace up to `function`.
    this.removeKeepingLines(infer.start, infer.end);
    // The reserved marker (NOLA1019) reaches the lowerer in tolerant mode only
    // — strict parsing threw. Its bytes must not reach TypeScript (the header
    // would not parse), and `broken` opts the editor out of completing there.
    // Line terminators stay, as everywhere a literal leaves the file.
    const marker = fn.nolaMarker;
    if (marker) {
      const terminators = this.source.slice(marker.start, marker.end).replace(/[^\r\n]/g, "");
      this.s.overwrite(marker.start, marker.end, terminators, { broken: true });
    }
    const body = fn.body;
    if (!body) return;

    // Harvest params into FunctionScopeInit args: every named param contributes
    // its name and, when annotated, a site accessor the checker fills in. Only
    // `.`-prefixed params contribute the live value. Plain params derive under
    // "omit" — an underivable plain type just yields no schema, silently, as
    // before; contextual params follow the configured policy: a value the model
    // receives without a schema is the silent failure the policy exists to
    // surface.
    const argEntries: string[] = [];
    const paramNames: string[] = [];
    for (const p of (fn.params ?? []) as NolaParamNode[]) {
      // Tolerant-parse placeholder: a `.` context parameter whose name is
      // still being typed. The node IS the marker, and its bytes sit exactly
      // where the editor maps the cursor — leaving them would put a dot in the
      // generated TS and TypeScript would answer the `.`-triggered completion
      // with the whole global scope. A parameter list has nothing to stand in
      // for, so the marker lowers to nothing; `broken` is what makes the editor
      // opt the character after it out of completion (see spansToMappings).
      if (p.nolaError) {
        this.s.overwrite(p.start, p.end, "", { broken: true });
        continue;
      }
      if (p.nolaContextual) this.s.remove(p.nolaContextual.start, p.nolaContextual.end);
      const target = p.type === "AssignmentPattern" ? ((p as AssignmentPatternNode).left as NolaParamNode) : p;
      if (target.type !== "Identifier") continue; // patterns: parser already diagnosed `.` misuse; nothing to harvest
      const paramName = target.name;
      if (!paramName) continue;
      paramNames.push(paramName);
      let typeExpr: string | undefined;
      const tsAnn = target.typeAnnotation?.typeAnnotation;
      if (tsAnn) {
        const accessor = this.request("context", tsAnn, {
          policy: p.nolaContextual ? this.underivableContextType : "omit",
        });
        typeExpr = `${accessor}()`;
      }
      argEntries.push(invocationArgEntry(paramName, typeExpr, Boolean(p.nolaContextual)));
    }

    // The wrapper opener sits at `{` (spec 2026-09-29 §3.3): a context
    // statement is a hoisted function inside the executor, passed by name to
    // the asks that see it — nothing has to sit outside the closure any more.
    // A LEFT-side insert: an overwrite starting at this offset (a statement
    // glued to the brace) clears the right-side intro of its chunk, never a
    // left-side outro.
    this.s.appendLeft(body.start + 1, invocationOpen(paramNames));
    this.meta.nolaFunctions.push(name);
    this.usedRuntime = true;
    // The module's top-level items above this declaration — its lexical view
    // of the module (spec 2026-09-29 §3.3) — snapshotted before later items.
    const moduleContext = [...this.moduleItems];
    // The body first: its contextual bindings are part of the closer's init.
    for (const child of children(body)) this.visit(child, "infer", false);
    const record = this.bodies[this.bodies.length - 1];
    this.s.appendLeft(body.end - 1, invocationClose(name, argEntries, record?.localEntries ?? [], moduleContext));
  }

  private lowerCallIntent(call: CallExpressionNode, body: AskBody): void {
    const tagged =
      call.callee.type === "TaggedTemplateExpression" ? (call.callee as TaggedTemplateExpressionNode) : undefined;
    // The hint literal is removed with the `(` and re-emitted inside the args
    // head — the copy-and-anchor treatment; the one literal that needs it.
    const inst = tagged
      ? this.instructionFieldFor(tagged.quasi, tagged.quasi.quasis.map((q) => q.value.cooked ?? q.value.raw).join(""))
      : { field: '""', copyText: "", anchors: [] as EditAnchor[], holes: [] as BaseNode[] };
    for (const arg of call.arguments) this.checkCallIntentArg(arg);
    // In the tagged form the callee expression is the tag; either way its
    // bytes stay verbatim in place as the `fn:` value, and the overwrite from
    // its end to the first argument removes the marker (if any) and the `(`.
    const callee = tagged ? tagged.tag : call.callee;
    const calleeText = this.source.slice(callee.start, callee.end);
    const simple = callee.type === "Identifier" || callee.type === "MemberExpression";
    const typeText = simple ? callIntentTypeText(calleeText) : "";
    this.s.appendLeft(call.start, callIntentOpen(typeText));
    const argsStart = this.argsStartOf(call);
    const rawHint = tagged ? rawTemplateText(this.source, tagged.quasi) : "";
    const def = defHash(this.displayFile, "call", calleeText, rawHint);
    const head = callIntentArgsHead(calleeText, inst.field, call.loc.start, def);
    const copyAt = inst.copyText ? head.indexOf(inst.copyText) : -1;
    const anchors = copyAt >= 0 ? inst.anchors.map((a) => ({ ...a, textOffset: a.textOffset + copyAt })) : undefined;
    this.s.overwrite(callee.end, argsStart, head, anchors ? { anchors } : {});
    this.s.overwrite(call.end - 1, call.end, CALL_INTENT_CLOSE);
    this.usedRuntime = true;
    this.visitCopiedHoles(inst.holes, body);
    // The arguments are this call's own slots — an extractor there is legal
    // even when the call is a context statement's value.
    const prevSite = this.holeSite;
    this.holeSite = "none";
    try {
      for (const arg of call.arguments) if (arg) this.visit(arg, body, false);
    } finally {
      this.holeSite = prevSite;
    }
  }

  /**
   * Where a call's arguments begin: right after the `(`, so the bytes between
   * it and the first argument — the line terminators of a call written one
   * argument per line (the layout invariant, 2026-10-15), or the null Babel's
   * recovery leaves for an empty first argument (`f(, 1)`, tolerant mode) —
   * stay in the emitted args; a slot after a hole keeps its arity.
   */
  private argsStartOf(call: CallExpressionNode): number {
    const typed = call as CallExpressionNode & { typeArguments?: BaseNode; typeParameters?: BaseNode };
    const from = typed.typeArguments?.end ?? typed.typeParameters?.end ?? call.callee.end;
    return this.source.indexOf("(", from) + 1;
  }

  /**
   * The line terminators inside a source range a lowering replaces whole. An
   * ask lowers to one expression, but its type, its list and its parts may
   * stand on their own lines; the debugger binds a `.tsi` breakpoint raw, by
   * line, on the compiled script, so the lowered text keeps every terminator
   * (AGENTS.md "LAYOUT IS LOAD-BEARING") — emitted in front of the
   * replacement, where no anchor is disturbed.
   */
  private lineTerminatorsIn(start: number, end: number): string {
    return (this.source.slice(start, end).match(/\r\n|\n|\r/g) ?? []).join("");
  }

  /**
   * NOLA2004 for untyped extractors in slot positions: direct args and anywhere
   * inside plain object/array literal nesting (mirrors the runtime slot walk).
   * A null argument (an empty one under Babel's recovery) has nothing to check.
   */
  private checkCallIntentArg(arg: BaseNode | null | undefined): void {
    if (!arg) return;
    if (arg.type === "NolaExtractExpression") {
      const extract = arg as NolaExtractExpression;
      if (extract.parts.length > 1) {
        this.diag(
          Codes.AskSequenceReserved,
          "a slot's instruction is one text — an ask sequence inside a call slot is reserved for a future Nola version.",
          arg,
        );
        return;
      }
      if (!extract.typeArgs) {
        this.diag(
          Codes.UntypedCallIntentArg,
          "an extractor used as a call-intent argument must have an explicit type — write ..`…`: T here.",
          arg,
        );
      }
      return;
    }
    if (arg.type === "ObjectExpression") {
      for (const prop of (arg as ObjectExpressionNode).properties) {
        if (prop.type === "ObjectProperty") this.checkCallIntentArg((prop as ObjectPropertyNode).value);
      }
      return;
    }
    if (arg.type === "ArrayExpression") {
      for (const el of (arg as ArrayExpressionNode).elements) {
        if (el) this.checkCallIntentArg(el);
      }
    }
  }

  private lowerExtract(node: NolaExtractExpression, body: AskBody): void {
    const quasi = node.quasi;
    if (!quasi) return;
    const { parts } = node;
    // the three legacy shapes keep their lowering byte for byte (spec 2026-10-12 §1.5, §5)
    if (parts.length === 2 && parts[1]?.type === "NolaToolList") {
      this.lowerToolUse(node, quasi, (parts[1] as NolaToolListNode).entries, body);
      return;
    }
    if (parts.length > 1) {
      const classified = this.classifyParts(node);
      if (classified) this.lowerSequence(node, classified, body);
      return;
    }
    let typeExpr = EXTRACT_DEFAULT_TYPE_EXPR;
    let typeText = EXTRACT_DEFAULT_TYPE_TEXT;
    const typeNode = node.typeArgs?.params[0];
    let typeSrc = "";
    if (typeNode) {
      typeSrc = this.source.slice(typeNode.start, typeNode.end);
      typeText = typeArgsText(typeSrc);
      // The authored <T> is a site accessor the checker fills in; the anchor
      // below is where the checker reads the type (its lowered range).
      typeExpr = `${this.request("extract", typeNode)}()`;
    }
    // Prefix up to (but not including) the template preserves the template's
    // original bytes; each ${expr} gets __nola.fmt(...) wrapped around it.
    // An authored <T> is copied into the prefix byte-identically — anchor it
    // so navigation/hover/completion work on the type text at the ask site.
    const open = extractOpen(typeText);
    const anchors = typeNode
      ? [
          {
            sourceStart: typeNode.start,
            sourceEnd: typeNode.end,
            textOffset: open.indexOf(typeText) + 1,
          },
        ]
      : undefined;
    if (node.start < quasi.start) {
      this.s.overwrite(node.start, quasi.start, open, { anchors });
    } else {
      // Implied sigil (spec 2026-09-18): nothing to overwrite in front of the
      // template. The enclosing ask's `ask ` overwrite ends here; appendLeft
      // lands after it and finalize() coalesces the two into one replaced span.
      this.s.appendLeft(node.start, open, { anchors });
    }
    for (const expr of quasi.expressions) {
      if (isPlaceholderHole(expr)) continue; // the visit below replaces it with the inert text
      this.s.appendLeft(expr.start, FMT_OPEN);
      this.s.appendLeft(expr.end, FMT_CLOSE);
    }
    const def = defHash(this.displayFile, "extract", rawTemplateText(this.source, quasi), typeSrc);
    const suffix = extractClose(typeExpr, node.loc.start, def);
    if (node.end > quasi.end) {
      // Replaces the <T> span (which follows the template), keeping the line
      // terminators of a type written on its own line.
      this.s.overwrite(quasi.end, node.end, this.lineTerminatorsIn(quasi.end, node.end) + suffix);
    } else {
      // appendLeft: must precede an enclosing ask's appendRight ")".
      this.s.appendLeft(node.end, suffix);
    }
    this.usedRuntime = true;
    for (const expr of quasi.expressions) this.visit(expr, body, false);
  }

  /**
   * A tool-use ask (spec 2026-10-08 §3.3, entries by value 2026-10-09 §3.3):
   * the extractor's shape with the list between the template and the type.
   * The opener is the extractor's (the answer type copied and anchored, an
   * `extract` request); the closer overwrites the list and the type — each
   * entry re-emitted as a DEFERRED SOURCE, `__nola.tool(<entry>, <verdict>(),
   * "<written>"?, <receiver>?)` for a bare entry and `__nola.toolSpread(<arg>,
   * <verdict>())` for a spread, with the entry's text ANCHORED (hover,
   * definition and the missing-import fix work inside the brackets, and the
   * anchor is where the `tool` request's checker walk reads the type). The
   * written text rides only for a name or a dotted chain — the tool's name,
   * or a group's prefix; a member expression passes its object as the
   * receiver (bound at run time, since `.bind` on a group would throw). The
   * def hashes the written entries in order after the type text. Two written
   * entries that would share a wire name — the same name twice, `a.b` beside
   * `a_b` — are NOLA2018 here, before any checker runs, since the model's
   * tool calls come back by that name; what a group declares is checked by
   * finalize, and the live list by the runtime (NOLA3022).
   */
  private lowerToolUse(node: NolaExtractExpression, quasi: TemplateLiteralNode, tools: BaseNode[], body: AskBody): void {
    let typeExpr = EXTRACT_DEFAULT_TYPE_EXPR;
    let typeText = EXTRACT_DEFAULT_TYPE_TEXT;
    const typeNode = node.typeArgs?.params[0];
    let typeSrc = "";
    if (typeNode) {
      typeSrc = this.source.slice(typeNode.start, typeNode.end);
      typeText = typeArgsText(typeSrc);
      typeExpr = `${this.request("extract", typeNode)}()`;
    }
    const open = toolUseOpen(typeText);
    const openAnchors = typeNode
      ? [{ sourceStart: typeNode.start, sourceEnd: typeNode.end, textOffset: open.indexOf(typeText) + 1 }]
      : undefined;
    if (node.start < quasi.start) {
      this.s.overwrite(node.start, quasi.start, open, { anchors: openAnchors });
    } else {
      this.s.appendLeft(node.start, open, { anchors: openAnchors });
    }
    for (const expr of quasi.expressions) {
      if (isPlaceholderHole(expr)) continue;
      this.s.appendLeft(expr.start, FMT_OPEN);
      this.s.appendLeft(expr.end, FMT_CLOSE);
    }
    const ask = locText(node.loc.start);
    // the list always follows the template, so there are bytes to overwrite;
    // a list spanning lines, or a type on its own line, keeps its terminators
    const kept = this.lineTerminatorsIn(quasi.end, node.end);
    const { text, anchors, written } = this.toolSourcesText(tools, ask, new Map(), new Map(), kept.length + TOOLS_OPEN.length);
    const def = defHash(this.displayFile, "tool-use", rawTemplateText(this.source, quasi), `${typeSrc}\n${written.join(",")}`);
    this.s.overwrite(quasi.end, node.end, kept + TOOLS_OPEN + text + toolUseClose(typeExpr, node.loc.start, def), { anchors });
    this.usedRuntime = true;
    for (const expr of quasi.expressions) this.visit(expr, body, false);
  }

  /**
   * The deferred sources of one list's entries (spec 2026-10-09 §3.3) as the
   * text that replaces the list's bytes — `__nola.tool(…)` / `__nola.toolSpread(…)`
   * joined by `, ` — with an anchor per entry (textOffset counted from
   * `textBase`, where the text lands in the replacement). `wire` and `earlier`
   * span every list of one ask (spec 2026-10-12 §3.4): a written text seen in
   * an earlier list is ONE tool — re-emitted where it is written again, under
   * the earlier list's accessor, so the model reads each list's names where
   * written (§1.4) while the verdict is requested and checked once; the same
   * text twice in ONE list, or two texts sharing a wire name, are NOLA2018.
   */
  private toolSourcesText(
    entries: BaseNode[],
    ask: string,
    wire: Map<string, string>,
    earlier: Map<string, EmittedEntry>,
    textBase: number,
  ): { text: string; anchors: EditAnchor[]; written: string[] } {
    let text = "";
    const anchors: EditAnchor[] = [];
    const written: string[] = [];
    const fresh: Array<[string, EmittedEntry]> = [];
    for (const entry of entries) {
      const spread = entry.type === "SpreadElement";
      const target = spread ? (entry as unknown as { argument: BaseNode }).argument : entry;
      const entryText = this.source.slice(entry.start, entry.end);
      written.push(entryText);
      const targetText = this.source.slice(target.start, target.end);
      const prev = earlier.get(entryText);
      if (prev !== undefined) {
        if (text !== "") text += ", ";
        text += toolSourceOpen(prev.spread);
        anchors.push({ sourceStart: target.start, sourceEnd: target.end, textOffset: textBase + text.length });
        text += targetText + toolSourceClose(prev.accessor, prev.spread, prev.writtenName, prev.receiver);
        continue;
      }
      // a name or a dotted chain is the tool's name (a single function) or the group's prefix
      const writtenName = !spread && isNameChain(target) ? targetText : undefined;
      if (writtenName !== undefined) {
        const wireName = toolWireName(writtenName);
        const prior = wire.get(wireName);
        if (prior === undefined) {
          wire.set(wireName, writtenName);
        } else {
          this.diag(
            Codes.ToolEntryInvalid,
            prior === writtenName
              ? `'${writtenName}' is listed twice in the tool list.`
              : `tools '${prior}' and '${writtenName}' would share the name '${wireName}' on the wire — a model's tool call comes back by that name; rename one of them.`,
            entry,
          );
        }
      }
      // A member expression keeps its receiver: its object rides to the runtime and the method is bound to it at
      // the call (spec §1.6). The object is evaluated once more for that, so it must be a plain chain — a name,
      // `this`, dotted / indexed / optional access over one; an object with a call is refused, never run twice.
      const member = !spread && (target.type === "MemberExpression" || target.type === "OptionalMemberExpression");
      const object = member ? (target as unknown as { object: BaseNode }).object : undefined;
      let receiver: string | undefined;
      if (object) {
        if (isPureChain(object)) {
          receiver = this.source.slice(object.start, object.end);
        } else {
          this.diag(
            Codes.ToolEntryInvalid,
            `'${targetText}' reaches a method through an object Nola cannot repeat — the object is evaluated once more to bind the method, so it must be a name, \`this\`, or a dotted / indexed chain over one; name the object first (\`const o = …\`) and list the method on it.`,
            entry,
          );
        }
      }
      const accessor = this.request("tool", target, {
        tool: { ask, ...(spread ? { spread: true as const } : {}), ...(writtenName !== undefined ? { written: writtenName } : {}) },
      });
      if (text !== "") text += ", ";
      text += toolSourceOpen(spread);
      anchors.push({ sourceStart: target.start, sourceEnd: target.end, textOffset: textBase + text.length });
      text += targetText + toolSourceClose(accessor, spread, writtenName, receiver);
      fresh.push([entryText, { accessor, spread, ...(writtenName !== undefined ? { writtenName } : {}), ...(receiver !== undefined ? { receiver } : {}) }]);
    }
    // recorded after the list, so a text repeated within ONE list still meets the wire check above
    for (const [k, v] of fresh) earlier.set(k, v);
    return { text, anchors, written };
  }

  /**
   * The ask sequence (spec 2026-10-12 §3.4). The opener goes before the
   * first text, every later part gets `, ` plus its own wrapper at its
   * start, the closer overwrites the type bytes after the last part. Texts
   * and values keep their bytes on their lines; the def hashes the parts'
   * raw texts joined by newlines.
   */
  private lowerSequence(node: NolaExtractExpression, c: ClassifiedParts, body: AskBody): void {
    const quasi = node.quasi as TemplateLiteralNode;
    let typeExpr = EXTRACT_DEFAULT_TYPE_EXPR;
    let typeText = EXTRACT_DEFAULT_TYPE_TEXT;
    const typeNode = c.kind === "call" ? undefined : node.typeArgs?.params[0];
    let typeSrc = "";
    if (c.kind === "call") {
      const call = c.parts.find((p) => p.kind === "func")?.node as CallExpressionNode;
      typeText = callIntentTypeText(this.source.slice(call.callee.start, call.callee.end));
    } else if (typeNode) {
      typeSrc = this.source.slice(typeNode.start, typeNode.end);
      typeText = typeArgsText(typeSrc);
      typeExpr = `${this.request("extract", typeNode)}()`;
    } else {
      this.diag(Codes.UntypedCallIntentArg, "an extractor must have an explicit type — write `: T` after the last part.", node);
    }
    const open = sequenceOpen(SEQUENCE_CLASS[c.kind], typeText);
    const openAnchors = typeNode
      ? [{ sourceStart: typeNode.start, sourceEnd: typeNode.end, textOffset: open.indexOf(typeText) + 1 }]
      : undefined;
    if (node.start < quasi.start) this.s.overwrite(node.start, quasi.start, open, { anchors: openAnchors });
    else this.s.appendLeft(node.start, open, { anchors: openAnchors });
    const raw: string[] = [];
    const ask = locText(node.loc.start);
    const wire = new Map<string, string>();
    const earlier = new Map<string, EmittedEntry>();
    let lastEnd = quasi.end;
    c.parts.forEach((p, i) => {
      const span = (p.node as NolaContextValueNode).nolaValueSpan ?? { start: p.node.start, end: p.node.end };
      if (i > 0) {
        // The separator goes at the previous part's end, after its own closer;
        // the source whitespace between the parts stays as the space, so the
        // parts keep their lines. Only glued parts need the space supplied.
        this.s.appendLeft(lastEnd, span.start === lastEnd ? SEQ_PART_SEP : ",");
      }
      switch (p.kind) {
        case "text": {
          const t = p.node as TemplateLiteralNode;
          for (const expr of t.expressions) {
            if (isPlaceholderHole(expr)) continue;
            this.s.appendLeft(expr.start, FMT_OPEN);
            this.s.appendLeft(expr.end, FMT_CLOSE);
          }
          raw.push(rawTemplateText(this.source, t));
          lastEnd = t.end;
          break;
        }
        case "obj": {
          raw.push(this.source.slice(span.start, span.end));
          // The value is an ordinary expression: visit it FIRST, so a nested ask
          // lowers (and anything inside it diagnoses) before the wrapper closes
          // the span — the closer must land after every inner edit, and the
          // type request is made only over bytes nothing touched.
          this.visit(p.node, body, false);
          lastEnd = this.lowerObjPart(p.node, span);
          break;
        }
        case "tools": {
          const list = p.node as NolaToolListNode;
          raw.push(`[${list.entries.map((e) => this.source.slice(e.start, e.end)).join(",")}]`);
          lastEnd = this.lowerListPart(list, ask, wire, earlier);
          break;
        }
        case "func": {
          raw.push(this.source.slice(p.node.start, p.node.end));
          lastEnd = this.lowerFuncPart(p.node as CallExpressionNode, body);
          break;
        }
      }
    });
    const def = defHash(this.displayFile, c.kind, raw.join("\n"), typeSrc);
    const close = sequenceClose(c.kind, typeExpr, node.loc.start, def);
    // a type on its own line keeps its terminators in front of the close
    if (node.end > lastEnd) this.s.overwrite(lastEnd, node.end, this.lineTerminatorsIn(lastEnd, node.end) + close);
    else this.s.appendLeft(node.end, close);
    this.usedRuntime = true;
    // holes are ordinary expressions — a nested ask inside lowers; a value part and a call part were visited in place
    for (const p of c.parts) {
      if (p.kind === "text") for (const expr of (p.node as TemplateLiteralNode).expressions) this.visit(expr, body, false);
    }
  }

  /**
   * `__nola.var.obj({ value: <bytes>, name, type? })` around a bare value,
   * visited already; returns the part's end. The type is a `value` request
   * only when the value's bytes are one verbatim run — a nested ask, a
   * binding or a context statement inside it (diagnosed by the visit) have
   * edited them, and a request there would have no lowered range.
   */
  private lowerObjPart(value: BaseNode, span: { start: number; end: number }): number {
    const name = this.source.slice(span.start, span.end);
    const accessor = this.s.hasEditsIn(span.start, span.end)
      ? undefined
      : this.request("value", value, { source: { start: span.start, end: span.end, loc: value.loc }, policy: "omit" });
    this.s.appendLeft(span.start, OBJ_PART_OPEN);
    this.s.appendLeft(span.end, objPartClose(name, accessor));
    return span.end;
  }

  /** `__nola.var.tools(<sources>)` over a list's bytes; returns the part's end. */
  private lowerListPart(list: NolaToolListNode, ask: string, wire: Map<string, string>, earlier: Map<string, EmittedEntry>): number {
    const kept = this.lineTerminatorsIn(list.start, list.end); // a list spanning lines keeps them
    const { text, anchors } = this.toolSourcesText(list.entries, ask, wire, earlier, kept.length + TOOLS_PART_OPEN.length);
    this.s.overwrite(list.start, list.end, kept + TOOLS_PART_OPEN + text + TOOLS_PART_CLOSE, { anchors });
    return list.end;
  }

  /** `__nola.var.func({ fn: <callee>, name, args: [<arguments>] })` around a call part; its slots lower as a call intent's do. */
  private lowerFuncPart(call: CallExpressionNode, body: AskBody): number {
    for (const arg of call.arguments) this.checkCallIntentArg(arg);
    const callee = call.callee;
    const calleeText = this.source.slice(callee.start, callee.end);
    this.s.appendLeft(call.start, FUNC_PART_OPEN);
    const argsStart = this.argsStartOf(call);
    this.s.overwrite(callee.end, argsStart, funcPartArgsHead(calleeText));
    this.s.overwrite(call.end - 1, call.end, FUNC_PART_CLOSE);
    const prevSite = this.holeSite;
    this.holeSite = "none";
    try {
      for (const arg of call.arguments) if (arg) this.visit(arg, body, false);
    } finally {
      this.holeSite = prevSite;
    }
    return call.end;
  }
}
