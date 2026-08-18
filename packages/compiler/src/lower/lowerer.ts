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
  type TaggedTemplateExpressionNode,
  type TemplateLiteralNode,
  walk,
} from "@nola-lang/ast";
import { companionSpecifierFor } from "../companion-name.js";
import { collectTypeRegistry } from "../schema.js";
import {
  type AccessorPlan,
  buildAccessorPlan,
  type CompanionImport,
  collectTypeImports,
  type DeriveContext,
  deriveTypeExpr,
} from "../schema-expr.js";
import { anchorInsertedLines, type EditAnchor, SpanRecorder } from "../spans.js";
import type { CompileResult } from "../types.js";
import {
  ASK_OPEN,
  askClose,
  BROKEN_CONSTRUCT,
  CALL_INTENT_CLOSE,
  callIntentArgsHead,
  callIntentOpen,
  callIntentTypeText,
  companionImportDecl,
  EXTRACT_DEFAULT_TYPE_EXPR,
  EXTRACT_DEFAULT_TYPE_TEXT,
  extractClose,
  extractOpen,
  extractOpenTemplate,
  FMT_CLOSE,
  FMT_OPEN,
  invocationArgEntry,
  invocationClose,
  invocationOpen,
  rawTemplateText,
  runtimeImport,
  SCOPE_PARAM,
  TEMPLATE_OPEN,
  templateCopy,
  typeAccessorDecl,
  typeArgsText,
} from "./templates.js";



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
  /** named types needing a __nola_type_<Name> accessor in the appendix, in first-use order */
  private readonly typeAccessors = new Map<string, string>();
  /** local binding name -> companion import emitted in the appendix */
  private readonly companionImports = new Map<string, CompanionImport>();
  /** shared derivation context (registry, imports, display file, bare ref names) */
  private readonly deriveCtx: DeriveContext;
  /** policy for underivable `.`-contextual param types (compiler.underivableContextType) */
  private readonly underivableContextType: "error" | "prune" | "omit";

  constructor(
    source: string,
    file: string,
    ast: BaseNode,
    displayFile: string,
    options: { underivableContextType?: "error" | "prune" | "omit" } = {},
  ) {
    this.s = new SpanRecorder(source);
    this.source = source;
    this.file = file;
    this.displayFile = displayFile;
    this.ast = ast;
    this.underivableContextType = options.underivableContextType ?? "error";
    this.deriveCtx = {
      source,
      registry: collectTypeRegistry(ast),
      imports: collectTypeImports(ast),
      importerDisplayFile: displayFile,
      refQualifier: "",
    };
  }

  run(): CompileResult {
    this.visit(this.ast, false, true);

    if (this.usedRuntime) {
      let appendix = runtimeImport(this.displayFile);
      for (const [name, expr] of this.typeAccessors) appendix += typeAccessorDecl(name, expr);
      for (const [local, imp] of this.companionImports) appendix += companionImportDecl(local, imp);
      this.s.appendix(appendix);
    }

    const map = this.s.generateMap({ source: this.file, hires: true, includeContent: true });
    const { spans, anchors } = this.s.finalize(this.source.length);
    anchorInsertedLines(map, spans, this.s.toString(), this.source);
    const companions = [
      ...new Set([...this.companionImports.values()].map((i) => companionSpecifierFor(i.specifier))),
    ].sort();

    return {
      code: this.s.toString(),
      map,
      diagnostics: this.diagnostics,
      meta: { ...this.meta, spans, anchors, companions, mode: "lowered" },
    };
  }

  private diag(code: string, message: string, node: BaseNode): void {
    this.diagnostics.push({ code, message, file: this.file, start: node.start, end: node.end, loc: node.loc });
  }

  /** Fold a derivation's transitive needs (accessors, companion imports) into the state. */
  private absorbPlan(companions: Map<string, CompanionImport>, plan: AccessorPlan): void {
    for (const [local, imp] of companions) this.companionImports.set(local, imp);
    for (const [name, expr] of plan.accessors) {
      if (!this.typeAccessors.has(name)) this.typeAccessors.set(name, expr);
    }
    for (const [local, imp] of plan.companions) this.companionImports.set(local, imp);
  }

  private absorbTypeNeeds(refs: Set<string>, companions: Map<string, CompanionImport>): void {
    const plan = buildAccessorPlan(refs, this.deriveCtx);
    this.absorbPlan(companions, plan);
    for (const e of plan.errors) this.diag(Codes.UnsupportedIntentType, e.message, e.node);
  }

  /**
   * A `.`-contextual param's type failed to derive (shallowly or in its
   * accessor plan). Resolve it per the configured policy; the returned expr
   * (if any) replaces the failed one.
   */
  private applyContextTypePolicy(tsAnn: BaseNode, paramName: string, reason: string): string | undefined {
    switch (this.underivableContextType) {
      case "omit":
        return undefined;
      case "prune":
        return this.pruneDerive(tsAnn);
      case "error":
        this.diag(
          Codes.UnderivableContextType,
          `contextual parameter '${paramName}' has a type that cannot be derived for inference: ${reason}. ` +
          `Set compiler.underivableContextType to "prune" or "omit" in nola.config.ts to allow it.`,
          tsAnn,
        );
        return undefined;
    }
  }

  /**
   * Lossy derivation for the prune policy: underivable object members drop out
   * instead of failing the type. Named refs derive lazily, so "underivable" is
   * discovered through the accessor plan — every plan failure marks its type
   * dead and the derivation reruns with refs to dead names failing (and thus
   * pruning) at their use sites. deadRefs grows monotonically and is bounded
   * by the registry, so the loop terminates. Returns undefined (-> omit) when
   * the top-level type itself prunes away.
   */
  private pruneDerive(tsAnn: BaseNode): string | undefined {
    const deadRefs = new Set<string>();
    const ctx: DeriveContext = { ...this.deriveCtx, lossy: true, deadRefs };
    for (; ;) {
      const derived = deriveTypeExpr(tsAnn, ctx);
      if (!derived.ok) return undefined;
      const plan = buildAccessorPlan(derived.refs, ctx);
      if (plan.errors.length === 0) {
        this.absorbPlan(derived.companions, plan);
        return derived.expr;
      }
      for (const e of plan.errors) deadRefs.add(e.name);
    }
  }

  // inNolaFnBody: directly inside a nola function body.
  // topLevel: current node is a direct child of Program (or an export wrapper).
  private visit(node: BaseNode, inNolaFnBody: boolean, topLevel: boolean): void {
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
          this.s.overwrite(node.start, node.end, BROKEN_CONSTRUCT, { broken: true });
          return;
        }
        this.lowerExtract(extract, inNolaFnBody);
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
      case "NolaAskExpression": {
        if (this.inCopiedHole) {
          this.diagCopiedHole(node);
          return;
        }
        const ask = node as NolaAskExpression;
        if (!inNolaFnBody) {
          this.diag(
            Codes.AskOutsideNolaFunction,
            "`ask` is only allowed directly inside an infer function body.",
            node,
          );
        } else {
          // Overwriting up to the operand also removes an `with <alias>` span;
          // the alias re-enters as ask's third argument.
          this.s.overwrite(node.start, ask.argument.start, ASK_OPEN);
          // appendRight: extract-lowering suffixes use appendLeft at the same
          // position and must land BEFORE this closing paren.
          this.s.appendRight(node.end, askClose(ask.provider?.name));
          this.usedRuntime = true;
        }
        this.visit(ask.argument, inNolaFnBody, false);
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

        this.lowerInferFunction(fn);

        if (fn.body) {
          for (const child of children(fn.body)) {
            this.visit(child, true, false);
          }
        }
        return;
      }
      case "CallExpression": {
        const call = node as CallExpressionNode;
        if (call.callee.type === "TaggedTemplateExpression") {
          if (this.inCopiedHole) {
            this.diagCopiedHole(node);
            return;
          }
          this.lowerCallIntent(call, inNolaFnBody);
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
          this.lowerCallIntent(call, inNolaFnBody);
          return;
        }
        break;
      }
      case "VariableDeclarator": {
        // Reserved contextual binding (`const .x`, NOLA1014): the parser kept
        // the declarator and parked the marker span on its id. Strict mode
        // never gets here (raise throws); in tolerant mode the dot must not
        // reach the generated TS, and `broken` opts the cursor position out of
        // completion exactly as the parameter marker does.
        const id = (node as { id?: NolaVariableIdNode }).id;
        if (id?.nolaReservedMarker) {
          this.s.overwrite(id.nolaReservedMarker.start, id.nolaReservedMarker.end, "", { broken: true });
        }
        break;
      }
      default:
        break;
    }
    const isFunctionScope =
      node.type === "FunctionDeclaration" ||
      node.type === "FunctionExpression" ||
      node.type === "ArrowFunctionExpression" ||
      node.type === "ObjectMethod" ||
      node.type === "ClassMethod";
    const nextTopLevel =
      node.type === "File" ||
      node.type === "Program" ||
      (topLevel && (node.type === "ExportNamedDeclaration" || node.type === "ExportDefaultDeclaration"));
    for (const child of children(node)) {
      this.visit(child, isFunctionScope ? false : inNolaFnBody, nextTopLevel);
    }
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
  private visitCopiedHoles(holes: BaseNode[], inNolaFnBody: boolean): void {
    const prevSite = this.scopeSite;
    const prevHole = this.inCopiedHole;
    this.scopeSite = "copy";
    this.inCopiedHole = true;
    try {
      for (const e of holes) this.visit(e, inNolaFnBody, false);
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
    // name (+ InferType when derivable); only `.`-prefixed params contribute
    // the live value. Plain params with underivable/unannotated types are
    // silently omitted in every mode — their type never describes a live value.
    // Contextual params follow the underivableContextType policy: a value the
    // model receives without a schema is the silent failure the policy exists
    // to surface.
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
        // ref() derivation is lazy — a named type's body only derives inside
        // the accessor plan, so "derivable" is only known once the plan builds
        // cleanly. Absorb nothing on failure: no dangling __nola_type_* ref.
        const derived = deriveTypeExpr(tsAnn, this.deriveCtx);
        const failure = derived.ok
          ? (() => {
            const plan = buildAccessorPlan(derived.refs, this.deriveCtx);
            if (plan.errors.length > 0) return plan.errors[0] as { message: string };
            typeExpr = derived.expr;
            this.absorbPlan(derived.companions, plan);
            return undefined;
          })()
          : derived;
        if (failure && p.nolaContextual) {
          typeExpr = this.applyContextTypePolicy(tsAnn, paramName, failure.message);
        }
      }
      argEntries.push(invocationArgEntry(paramName, typeExpr, Boolean(p.nolaContextual)));
    }

    // The marker literal cannot stay between the name and `(`; its text lands
    // in the wrapper closer. Prose is a JSON string as before; holes make it a
    // template literal (lexical) or a prompt-template closure (`${.member}`),
    // both copied byte-identically with anchors so the editor keeps completion,
    // hover and precise TS errors inside the marker.
    const inst =
      marker?.quasi !== undefined
        ? this.instructionFieldFor(marker.quasi, marker.hasScopeAccess === true, marker.instruction)
        : { field: JSON.stringify(marker?.instruction ?? ""), copyText: "", anchors: [], holes: [] };
    const close = invocationClose(name, inst.field, argEntries);
    const copyAt = inst.copyText ? close.indexOf(inst.copyText) : -1;
    const anchors = copyAt >= 0 ? inst.anchors.map((a) => ({ ...a, textOffset: a.textOffset + copyAt })) : undefined;
    this.s.appendRight(body.start + 1, invocationOpen(paramNames));
    this.s.appendLeft(body.end - 1, close, anchors ? { anchors } : {});
    this.meta.nolaFunctions.push(name);
    this.usedRuntime = true;
    this.visitCopiedHoles(inst.holes, false);
  }

  private lowerCallIntent(call: CallExpressionNode, inNolaFnBody: boolean): void {
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
    const head = callIntentArgsHead(calleeText, inst.field, call.loc.start);
    const copyAt = inst.copyText ? head.indexOf(inst.copyText) : -1;
    const anchors = copyAt >= 0 ? inst.anchors.map((a) => ({ ...a, textOffset: a.textOffset + copyAt })) : undefined;
    this.s.overwrite(callee.end, argsStart, head, anchors ? { anchors } : {});
    this.s.overwrite(call.end - 1, call.end, CALL_INTENT_CLOSE);
    this.usedRuntime = true;
    this.visitCopiedHoles(inst.holes, inNolaFnBody);
    for (const arg of call.arguments) this.visit(arg, inNolaFnBody, false);
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

  private lowerExtract(node: NolaExtractExpression, inNolaFnBody: boolean): void {
    const quasi = node.quasi;
    if (!quasi) return;
    let typeExpr = EXTRACT_DEFAULT_TYPE_EXPR;
    let typeText = EXTRACT_DEFAULT_TYPE_TEXT;
    if (node.typeArgs) {
      const t = node.typeArgs.params[0];
      if (t) {
        typeText = typeArgsText(this.source.slice(t.start, t.end));
        const derived = deriveTypeExpr(t, this.deriveCtx);
        if (derived.ok) {
          typeExpr = derived.expr;
          this.absorbTypeNeeds(derived.refs, derived.companions);
        } else {
          this.diag(Codes.UnsupportedIntentType, derived.message, derived.node);
        }
      }
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
    const typeNode = node.typeArgs?.params[0];
    const anchors = typeNode
      ? [{ sourceStart: typeNode.start, sourceEnd: typeNode.end, textOffset: open.indexOf(typeText) + 1 }]
      : undefined;
    this.s.overwrite(node.start, quasi.start, open, { anchors });
    if (!isTemplate) {
      for (const expr of quasi.expressions) {
        this.s.appendLeft(expr.start, FMT_OPEN);
        this.s.appendLeft(expr.end, FMT_CLOSE);
      }
    }
    const suffix = extractClose(typeExpr, node.loc.start);
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
      for (const expr of quasi.expressions) this.visit(expr, inNolaFnBody, false);
    } finally {
      this.scopeSite = prevSite;
    }
  }
}
