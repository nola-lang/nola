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
  type NolaVariableIdNode,
  type ObjectExpressionNode,
  type ObjectPropertyNode,
  type TaggedTemplateExpressionNode,
  type TemplateLiteralNode,
  walk,
} from "@nola-lang/ast";
import type { UnderivableContextTypeMode } from "@nola-lang/core";
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
  inertAccessorDecl,
  invocationArgEntry,
  invocationClose,
  invocationOpen,
  MODULE_SCOPE_CALL,
  rawTemplateText,
  runtimeImport,
  siteAccessorName,
  TEXT_JOIN_HOLE,
  templateCopy,
  typeArgsText,
  typeValueDecl,
  typeValueText,
} from "./templates.js";

/** The scope body a node sits directly in (scope-bodies spec §5.1); "none" is where `ask` is illegal. */
type AskBody = "infer" | "module" | "none";

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
      for (const r of this.requests) appendix += inertAccessorDecl(r.accessor, r.kind === "context");
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
    if (r.kind === "extract") {
      const a = anchors.find((x) => x.sourceStart === start && x.sourceEnd === end);
      if (a) return { start: a.generatedStart, end: a.generatedEnd };
    }
    const sp = spans.find((x) => x.kind === "verbatim" && x.sourceStart <= start && end <= x.sourceEnd);
    if (!sp) throw new Error(`lowerer: no verbatim span for ${r.kind} request ${r.accessor} at ${start}-${end}`);
    const delta = sp.generatedStart - sp.sourceStart;
    return { start: start + delta, end: end + delta };
  }

  private request(kind: DerivationRequest["kind"], node: BaseNode, extra: Partial<PendingRequest> = {}): string {
    const accessor = extra.accessor ?? siteAccessorName(++this.siteCounter);
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
        if (body === "none") {
          this.diag(
            Codes.AskOutsideNolaFunction,
            "`ask` is only allowed directly inside an infer function body or the module body.",
            node,
          );
        } else {
          // Overwriting up to the operand also removes an `with <alias>` span;
          // the alias re-enters as ask's third argument.
          this.s.overwrite(node.start, ask.argument.start, ASK_OPEN);
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
        const callIntent =
          call.callee.type === "TaggedTemplateExpression" ||
          ((call.callee.type === "Identifier" || call.callee.type === "MemberExpression") &&
            call.arguments.some((a) => this.hasExtractorSlot(a as BaseNode)));
        if (!callIntent) break;
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

  /**
   * Sigil-less call-intent detection (2026-08-14 spec): a well-formed extractor
   * in a slot position — a direct argument, or nested at any depth inside plain
   * object/array literals (the same walk checkCallIntentArg performs). Tolerant
   * placeholders (nolaError) do NOT count: a half-typed `f(..` stays a plain
   * call, so the editor never lowers a call intent around a broken slot.
   */
  private hasExtractorSlot(node: BaseNode): boolean {
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
    const argsStart = call.arguments.length > 0 ? (call.arguments[0] as BaseNode).start : call.end - 1;
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
      for (const arg of call.arguments) this.visit(arg, body, false);
    } finally {
      this.holeSite = prevSite;
    }
  }

  /**
   * NOLA2004 for untyped extractors in slot positions: direct args and anywhere
   * inside plain object/array literal nesting (mirrors the runtime slot walk).
   */
  private checkCallIntentArg(arg: BaseNode): void {
    if (arg.type === "NolaExtractExpression") {
      if (!(arg as NolaExtractExpression).typeArgs) {
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
      // Replaces the <T> span (which follows the template).
      this.s.overwrite(quasi.end, node.end, suffix);
    } else {
      // appendLeft: must precede an enclosing ask's appendRight ")".
      this.s.appendLeft(node.end, suffix);
    }
    this.usedRuntime = true;
    for (const expr of quasi.expressions) this.visit(expr, body, false);
  }
}
