import {
  type ArrayExpressionNode,
  type AssignmentPatternNode,
  type BaseNode,
  type CallExpressionNode,
  Codes,
  children,
  type Diagnostic,
  type NolaAskExpression,
  type NolaExtractExpression,
  type NolaFunctionNode,
  type NolaParamNode,
  type NolaVariableIdNode,
  type ObjectExpressionNode,
  type ObjectPropertyNode,
  programBody,
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
  BROKEN_CONSTRUCT,
  CALL_INTENT_CLOSE,
  callIntentArgsHead,
  callIntentOpen,
  callIntentTypeText,
  DECISION_WRAPPERS,
  defHash,
  EXTRACT_DEFAULT_TYPE_EXPR,
  EXTRACT_DEFAULT_TYPE_TEXT,
  extractClose,
  extractOpen,
  extractOpenTemplate,
  FMT_CLOSE,
  FMT_OPEN,
  FRAME_PARAM,
  inertAccessorDecl,
  invocationArgEntry,
  invocationClose,
  invocationOpen,
  localsArg,
  MODULE_SCOPE_CALL,
  MODULE_TEMPLATE_CLOSE,
  MODULE_TEMPLATE_FN,
  moduleTemplateOpen,
  PROB_BARE_TYPE_EXPR,
  rawTemplateText,
  runtimeImport,
  SCOPE_PARAM,
  siteAccessorName,
  TEMPLATE_OPEN,
  templateCopy,
  typeArgsText,
  typeValueDecl,
  typeValueText,
} from "./templates.js";

/** The scope body a node sits directly in (scope-bodies spec §5.1); "none" is where `ask` is illegal. */
type AskBody = "infer" | "module" | "none";

/**
 * A scope body's instruction literal (spec §2.3): its FIRST statement, when
 * that is a bare template literal. A string literal there is a JS directive
 * and is not claimed (Babel keeps directives out of `body` anyway).
 */
function bodyInstruction(statements: readonly BaseNode[]): { stmt: BaseNode; quasi: TemplateLiteralNode } | undefined {
  const stmt = statements[0];
  if (stmt?.type !== "ExpressionStatement") return undefined;
  const expr = (stmt as { expression?: BaseNode }).expression;
  if (expr?.type !== "TemplateLiteral") return undefined;
  return { stmt, quasi: expr as TemplateLiteralNode };
}

const hasScopeAccess = (quasi: TemplateLiteralNode) => (quasi as { nolaHasScopeAccess?: boolean }).nolaHasScopeAccess === true;

/** cooked quasis joined — holes contribute nothing (the marker's `instruction` rule) */
const cookedText = (quasi: TemplateLiteralNode) => quasi.quasis.map((q) => q.value.cooked ?? q.value.raw).join("");

/**
 * One scope body being lowered (an infer body or the module body): the static
 * half of its contextual bindings — the `locals: [{ name, type? }]` entries of
 * its scope init — and the block-scope stack that decides which of them an
 * ask can see (declared before it, in its block or an enclosing one).
 */
interface BodyRecord {
  localEntries: string[];
  scopes: string[][];
}

/** A request whose lowered range is resolved once the span tiling exists (end of run()). */
interface PendingRequest extends Omit<DerivationRequest, "lowered"> {
  lowered?: DerivationRequest["lowered"];
  /** the sugar's wrapper around the anchored type copy (`Choice<` … `>`): widens the lowered range past the anchor */
  loweredPad?: { before: number; after: number };
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
   * Where a `${.member}` scope access may appear right now: "inplace" — the
   * enclosing instruction literal stays where it is (extractor), so the scope
   * parameter is inserted before the dot here; "copy" — the literal is copied
   * elsewhere (marker / call hint) and the copy builder did the insertion;
   * "none" — not inside a Nola instruction literal (NOLA2009).
   */
  private scopeSite: "none" | "inplace" | "copy" = "none";
  /**
   * True while visiting the holes of a COPIED instruction literal (marker /
   * call hint). Nola constructs there have nowhere to lower to — the literal
   * is re-emitted from source bytes — so they are NOLA2010.
   */
  private inCopiedHole = false;
  /** derivation requests in declaration order: site accessors as met, exported types last */
  private readonly requests: PendingRequest[] = [];
  private siteCounter = 0;
  /** the module body asks — the appendix then carries the `__nola_module_ctx` accessor */
  private moduleAsks = false;
  /** the scope bodies being lowered, innermost last; the module body is the bottom entry */
  private readonly bodies: BodyRecord[] = [];
  /** the module body's first-statement instruction literal (spec §2.3), lowered after the walk */
  private moduleInstruction?: { stmt: BaseNode; quasi: TemplateLiteralNode };
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
    const moduleBody: BodyRecord = { localEntries: [], scopes: [[]] };
    this.bodies.push(moduleBody);
    this.moduleInstruction = bodyInstruction(programBody(this.ast));
    this.visit(this.ast, "module", true);
    this.bodies.pop();
    this.emitTypeValues();
    const instructionField = this.lowerModuleInstruction();

    // intrinsic decision types (spec 2026-09-18 §2.1): the appendix imports the
    // names the file uses and does not declare — which needs the appendix at all
    const decisionTypes = collectDecisionTypeUses(this.ast);
    if (decisionTypes.length > 0) this.usedRuntime = true;

    let accessorsStart = -1;
    if (this.usedRuntime) {
      let appendix = runtimeImport(
        this.displayFile,
        this.moduleAsks ? { instructionField, localEntries: moduleBody.localEntries } : undefined,
        decisionTypes,
      );
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
    const derivations = this.requests.map(({ loweredPad: _pad, ...r }) => ({
      ...r,
      lowered: r.lowered ?? this.loweredRange({ ...r, loweredPad: _pad }, spans, anchors),
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
      if (a) {
        const pad = r.loweredPad ?? { before: 0, after: 0 };
        return { start: a.generatedStart - pad.before, end: a.generatedEnd + pad.after };
      }
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
        if (this.inCopiedHole) {
          this.diagCopiedHole(node);
          return;
        }
        const extract = node as NolaExtractExpression;
        // Tolerant-parse placeholder: the diagnostic is already recorded, so
        // this only has to keep the generated text sane for the editor. The
        // marker's own bytes would otherwise leave a dot at the cursor and TS
        // would answer the next `.`-triggered completion with the global scope.
        if (extract.nolaError || !extract.quasi) {
          // The end-of-file placeholder is zero-width (an expression that was
          // never typed): there are no bytes to overwrite, so the inert text
          // is inserted at its position instead.
          if (node.start === node.end) this.s.appendLeft(node.start, BROKEN_CONSTRUCT, { broken: true });
          else this.s.overwrite(node.start, node.end, BROKEN_CONSTRUCT, { broken: true });
          return;
        }
        this.lowerExtract(extract, body);
        return;
      }
      case "NolaScopeAccess": {
        if (this.scopeSite === "none") {
          this.diag(
            Codes.ScopeAccessOutsideTemplate,
            // biome-ignore lint/suspicious/noTemplateCurlyInString: literal ${...} in a diagnostic message
            "`${.member}` scope access is only allowed inside a Nola instruction template (infer-function marker, extractor prompt, call-intent hint).",
            node,
          );
          this.s.overwrite(node.start, node.end, BROKEN_CONSTRUCT, { broken: true });
          return;
        }
        // In place: `.args` → `__nola_s.args`; the dot and member stay verbatim
        // (a half-typed `${.` placeholder gets the prefix too, so TS answers
        // completion after the dot). Copied literals were prefixed by the copy.
        if (this.scopeSite === "inplace") this.s.appendLeft(node.start, SCOPE_PARAM);
        return;
      }
      case "TSInstantiationExpression": {
        // `` `x`<T> `` is an extractor only directly after `ask`; anywhere
        // else TypeScript rejects type args on a non-generic expression. Say
        // what the author meant instead of leaving that to TS2635.
        if ((node as unknown as { expression: BaseNode }).expression.type === "TemplateLiteral") {
          this.diag(
            Codes.ExtractorSigilRequired,
            "a typed template literal is an extractor only directly after `ask`; write ..`…`<T> here.",
            node,
          );
        }
        break;
      }
      case "NolaAskExpression": {
        if (this.inCopiedHole) {
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
          if (body === "module") this.moduleAsks = true;
          const scope = body === "infer" ? FRAME_PARAM : MODULE_SCOPE_CALL;
          this.s.appendRight(node.end, askClose(scope, ask.provider?.name, localsArg(this.visibleLocals())));
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

        this.bodies.push({ localEntries: [], scopes: [[]] });
        this.lowerInferFunction(fn);
        this.bodies.pop();
        return;
      }
      case "CallExpression": {
        const call = node as CallExpressionNode;
        if (call.callee.type === "TaggedTemplateExpression") {
          if (this.inCopiedHole) {
            this.diagCopiedHole(node);
            return;
          }
          this.lowerCallIntent(call, body);
          return;
        }
        // Sigil-less form: extractor args imply the call intent. Simple
        // callees only — `new`, optional calls, super(), and exotic callees
        // (call results, parenthesized exprs) stay plain calls; the sigil
        // form keeps its wider callee latitude.
        if (
          (call.callee.type === "Identifier" || call.callee.type === "MemberExpression") &&
          call.arguments.some((a) => this.hasExtractorSlot(a as BaseNode))
        ) {
          this.lowerCallIntent(call, body);
          return;
        }
        break;
      }
      case "VariableDeclarator": {
        const id = (node as { id?: NolaVariableIdNode }).id;
        // Reserved forms (`var .x`, a pattern — NOLA1014 / NOLA1011): the
        // parser kept the declarator and parked the marker span on its id.
        // Strict mode never gets here (raise throws); in tolerant mode the dot
        // must not reach the generated TS, and `broken` opts the cursor
        // position out of completion exactly as the parameter marker does.
        if (id?.nolaReservedMarker) {
          this.s.overwrite(id.nolaReservedMarker.start, id.nolaReservedMarker.end, "", { broken: true });
          break;
        }
        if (id?.nolaContextual) {
          this.lowerContextualBinding(node, id, id.nolaContextual, body);
          return;
        }
        break;
      }
      case "ExpressionStatement": {
        // The module body's instruction literal is lowered after the walk (its
        // shape depends on whether the module asks); its holes are visited then.
        if (node === this.moduleInstruction?.stmt) return;
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
        current.scopes.push([]);
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

  /**
   * The module body's instruction literal (spec §5.3), once the walk knows
   * whether the module asks. Prose leaves the file and becomes the init's
   * `instruction` string; a literal with holes stays IN PLACE as the hoisted
   * `__nola_module_tpl` — a lexical-only one is the instruction (read at the
   * first ask), a `${.member}` one the scope's prompt template. Returns the
   * text after `instruction: ` for the module init, or undefined.
   */
  private lowerModuleInstruction(): string | undefined {
    const lit = this.moduleInstruction;
    if (!lit) return undefined;
    const scope = hasScopeAccess(lit.quasi);
    if (!this.moduleAsks && !scope) return undefined;
    const { quasi, stmt } = lit;
    if (quasi.expressions.length === 0) {
      this.s.remove(stmt.start, stmt.end);
      return JSON.stringify(cookedText(quasi));
    }
    // A bare template statement starts AT the literal (zero-length prefix) and
    // may end at it too (no `;`) — inserts, not overwrites, at those edges.
    this.s.appendLeft(quasi.start, moduleTemplateOpen(scope));
    if (stmt.end > quasi.end) this.s.overwrite(quasi.end, stmt.end, MODULE_TEMPLATE_CLOSE);
    else this.s.appendRight(quasi.end, MODULE_TEMPLATE_CLOSE);
    if (!scope) {
      for (const expr of quasi.expressions) {
        this.s.appendLeft(expr.start, FMT_OPEN);
        this.s.appendLeft(expr.end, FMT_CLOSE);
      }
    }
    // The holes: `${.member}` gets the scope parameter in place; a Nola
    // construct has nowhere to lower to inside a hoisted plain function.
    const prevSite = this.scopeSite;
    const prevHole = this.inCopiedHole;
    this.scopeSite = scope ? "inplace" : "none";
    this.inCopiedHole = true;
    try {
      for (const expr of quasi.expressions) this.visit(expr, "none", false);
    } finally {
      this.scopeSite = prevSite;
      this.inCopiedHole = prevHole;
    }
    return scope
      ? `${JSON.stringify(rawTemplateText(this.source, quasi))}, template: ${MODULE_TEMPLATE_FN}`
      : `${MODULE_TEMPLATE_FN}()`;
  }

  /** The contextual bindings an ask at this point can see, in declaration order. */
  private visibleLocals(): string[] {
    const current = this.bodies[this.bodies.length - 1];
    return current ? current.scopes.flat() : [];
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
      this.s.overwrite(marker.start, marker.end, "", { broken: true });
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
    (current.scopes[current.scopes.length - 1] as string[]).push(name);
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
      "Nola constructs are not allowed inside an infer-function marker or call-intent hint hole.",
      node,
    );
  }

  /**
   * The instruction field of a copied instruction literal (marker / call hint):
   * prose → JSON string; lexical holes → a template literal with fmt-wrapped
   * holes; `${.member}` holes → the raw text as the instruction plus the
   * template closure. Anchors point back at the literal's verbatim runs.
   */
  private instructionFieldFor(
    quasi: TemplateLiteralNode,
    hasScopeAccess: boolean,
    cooked: string,
  ): { field: string; copyText: string; anchors: EditAnchor[]; holes: BaseNode[] } {
    if (quasi.expressions.length === 0) return { field: JSON.stringify(cooked), copyText: "", anchors: [], holes: [] };
    const scopeNodes: BaseNode[] = [];
    if (hasScopeAccess) {
      walk(quasi, (n) => {
        if (n.type === "NolaScopeAccess") scopeNodes.push(n);
      });
    }
    const copy = templateCopy(this.source, quasi, scopeNodes, hasScopeAccess ? "scope" : "fmt");
    const field = hasScopeAccess
      ? `${JSON.stringify(rawTemplateText(this.source, quasi))}, ${TEMPLATE_OPEN}${copy.text}`
      : copy.text;
    return { field, copyText: copy.text, anchors: copy.anchors, holes: quasi.expressions };
  }

  /** Visit the holes of a copied literal only to diagnose (NOLA2010 / NOLA2009) — the copy is already built. */
  private visitCopiedHoles(holes: BaseNode[], body: AskBody): void {
    const prevSite = this.scopeSite;
    const prevHole = this.inCopiedHole;
    this.scopeSite = "copy";
    this.inCopiedHole = true;
    try {
      for (const e of holes) this.visit(e, body, false);
    } finally {
      this.scopeSite = prevSite;
      this.inCopiedHole = prevHole;
    }
  }

  private lowerInferFunction(fn: NolaFunctionNode): void {
    const infer = fn.nolaInfer;
    if (!infer) return;
    const name = fn.id?.name ?? "anonymous";
    // Removes `infer ` including trailing whitespace up to `function`.
    this.s.remove(infer.start, infer.end);
    const marker = fn.nolaMarker;
    if (marker) this.s.remove(marker.start, marker.end);
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

    // The instruction literal — the marker, or the body's first statement (an
    // alternate spelling, spec §2.3; both at once is NOLA2013) — cannot stay
    // where it is; its text lands in the wrapper closer. Prose is a JSON
    // string as before; holes make it a template literal (lexical) or a
    // prompt-template closure (`${.member}`), both copied byte-identically
    // with anchors so the editor keeps completion, hover and precise TS
    // errors inside the literal.
    const bodyLit = bodyInstruction((body as { body?: BaseNode[] }).body ?? []);
    if (marker && bodyLit) {
      this.diag(
        Codes.DuplicateInstruction,
        "this infer function already has an instruction marker — write the instruction in one place.",
        bodyLit.quasi,
      );
    }
    const useBody = bodyLit !== undefined && marker === undefined;
    const litQuasi = marker ? marker.quasi : bodyLit?.quasi;
    const inst = litQuasi
      ? this.instructionFieldFor(litQuasi, marker?.hasScopeAccess === true || hasScopeAccess(litQuasi), cookedText(litQuasi))
      : { field: JSON.stringify(marker?.instruction ?? ""), copyText: "", anchors: [], holes: [] };
    if (useBody) this.s.remove(bodyLit.stmt.start, bodyLit.stmt.end);
    this.s.appendRight(body.start + 1, invocationOpen(paramNames));
    this.meta.nolaFunctions.push(name);
    this.usedRuntime = true;
    this.visitCopiedHoles(inst.holes, "none");
    // The body first: its contextual bindings are part of the closer's init.
    for (const child of children(body)) {
      if (useBody && child === bodyLit.stmt) continue;
      this.visit(child, "infer", false);
    }
    const record = this.bodies[this.bodies.length - 1];
    const close = invocationClose(name, inst.field, argEntries, record?.localEntries ?? []);
    const copyAt = inst.copyText ? close.indexOf(inst.copyText) : -1;
    const anchors = copyAt >= 0 ? inst.anchors.map((a) => ({ ...a, textOffset: a.textOffset + copyAt })) : undefined;
    this.s.appendLeft(body.end - 1, close, anchors ? { anchors } : {});
  }

  private lowerCallIntent(call: CallExpressionNode, body: AskBody): void {
    const tagged =
      call.callee.type === "TaggedTemplateExpression" ? (call.callee as TaggedTemplateExpressionNode) : undefined;
    // The hint literal is removed with the `(` and re-emitted inside the args
    // head — same copy-and-anchor treatment as the infer-function marker.
    const inst = tagged
      ? this.instructionFieldFor(
          tagged.quasi,
          (tagged.quasi as { nolaHasScopeAccess?: boolean }).nolaHasScopeAccess === true,
          tagged.quasi.quasis.map((q) => q.value.cooked ?? q.value.raw).join(""),
        )
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
    for (const arg of call.arguments) this.visit(arg, body, false);
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
          "an extractor used as a call-intent argument must have an explicit <T>.",
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
    // The sugar (decision types spec §5) wraps the written argument —
    // `<Choice<C>>`: the copied C is the anchor, the derivation request's
    // lowered range is the whole wrapper (the checker must see a Choice).
    const wrapper = node.kind ? DECISION_WRAPPERS[node.kind] : undefined;
    const wrapPrefix = wrapper ? `${wrapper}<` : "";
    const typeNode = node.typeArgs?.params[0];
    let typeSrc = "";
    if (typeNode) {
      const written = this.source.slice(typeNode.start, typeNode.end);
      typeSrc = wrapper ? `${wrapPrefix}${written}>` : written;
      typeText = typeArgsText(typeSrc);
      // The authored <T> is a site accessor the checker fills in; the anchor
      // below is where the checker reads the type (its lowered range).
      typeExpr = `${this.request(
        "extract",
        typeNode,
        wrapper ? { loweredPad: { before: wrapPrefix.length, after: 1 } } : {},
      )}()`;
    } else if (node.kind === "prob") {
      typeSrc = DECISION_WRAPPERS.prob;
      typeText = typeArgsText(typeSrc);
      typeExpr = PROB_BARE_TYPE_EXPR;
    } else if (node.kind) {
      const hint =
        node.kind === "choice"
          ? 'a criteria type argument — write ..choice`…`<{ label: "description" }> or ..choice`…`<"a" | "b">'
          : 'a levels type argument — write ..scale`…`<["low", "high"]>';
      this.diagnostics.push({
        code: Codes.InvalidDecisionCriteria,
        message: `\`..${node.kind}\` needs ${hint}.`,
        file: this.file,
        start: node.start,
        end: node.end,
        loc: node.loc,
      });
    }
    // Prefix up to (but not including) the template preserves the template's
    // original bytes; each ${expr} gets __nola.fmt(...) wrapped around it.
    // An authored <T> is copied into the prefix byte-identically — anchor it
    // so navigation/hover/completion work on the type text at the ask site.
    // A `${.member}` literal is a prompt template: instruction keeps the raw
    // text (holes verbatim) and the literal itself becomes the body of the
    // template closure, in place — its bytes stay verbatim, only the scope
    // parameter is inserted before each scope dot (see the NolaScopeAccess
    // visit). Lexical holes inside a template are not fmt-wrapped: tpl formats.
    const isTemplate = (quasi as { nolaHasScopeAccess?: boolean }).nolaHasScopeAccess === true;
    const open = isTemplate ? extractOpenTemplate(typeText, rawTemplateText(this.source, quasi)) : extractOpen(typeText);
    const anchors = typeNode
      ? [
          {
            sourceStart: typeNode.start,
            sourceEnd: typeNode.end,
            textOffset: open.indexOf(typeText) + 1 + wrapPrefix.length,
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
    if (!isTemplate) {
      for (const expr of quasi.expressions) {
        this.s.appendLeft(expr.start, FMT_OPEN);
        this.s.appendLeft(expr.end, FMT_CLOSE);
      }
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
    const prevSite = this.scopeSite;
    this.scopeSite = isTemplate ? "inplace" : "none";
    try {
      for (const expr of quasi.expressions) this.visit(expr, body, false);
    } finally {
      this.scopeSite = prevSite;
    }
  }
}
