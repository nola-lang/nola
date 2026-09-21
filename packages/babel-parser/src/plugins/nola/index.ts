/**
 * NOLA PLUGIN — the reason this parser is vendored.
 * Adds (v2 surface):
 *  - `..`prompt`` extractor expressions, `${}` interpolation allowed;
 *  - `${.member}` scope access inside any template hole (NolaScopeAccess) —
 *    the prompt-template surface (spec 2026-08-17); every enclosing template
 *    literal is flagged nolaHasScopeAccess;
 *  - the `ask` unary operator;
 *  - `infer function` declarations (statement + export position) with an
 *    optional instruction marker between name and `(` (holes allowed);
 *  - reserved-construct errors for the removed empty-marker form, bare `(..)`,
 *    generator/method infer functions, and markers with substitutions.
 * Registered LAST-but-before-placeholders so it composes on top of the
 * typescript mixin (mixin order = key order in plugin-utils.ts).
 */
import * as charCodes from "charcodes";
import { OptionFlags } from "../../options.ts";
import { ParseErrorEnum } from "../../parse-error.ts";
import type Parser from "../../parser/index.ts";
import { ParseBindingListFlags } from "../../parser/lval.ts";
import type { Undone } from "../../parser/node.ts";
import { ParseFunctionFlag, type ParseStatementFlag } from "../../parser/statement.ts";
import type { ExpressionErrors } from "../../parser/util.ts";
import { tokenIsKeywordOrIdentifier, tt } from "../../tokenizer/types.ts";
import type * as N from "../../types.ts";
import type { Position } from "../../util/location.ts";

export const NolaErrors = ParseErrorEnum`nola`({
  NolaAskReserved: "NOLA1003: `ask` is a reserved word in .tsi files and cannot be used as an identifier.",
  NolaReservedConstruct: "NOLA1004: this Nola construct is reserved for a future Nola version.",
  NolaExpectedPromptTemplate: "NOLA1005: expected a template literal prompt after `..`.",
  NolaMarkerOutsideInfer: "NOLA1007: an instruction marker is only legal on an `infer function`.",
  NolaIncompleteScopeAccess: "NOLA1015: incomplete scope access — write `${.member}`.",
  NolaExpectedProviderName:
    "NOLA1009: expected a model name after `ask with` — for a dynamic model use `.withModel(...)` on the intent.",
  NolaContextualOutsideInfer: "NOLA1010: `.` context parameters are only allowed on infer function parameters.",
  NolaContextualParamReserved:
    "NOLA1011: `.` on this parameter form is reserved for a future Nola version — use a plain identifier parameter.",
  NolaIncompleteContextualParam: "NOLA1012: incomplete `.` context parameter — write `.name`.",
  NolaContextualParamDoubleDot:
    "NOLA1013: contextual parameters take one dot — write `.name` (`..` is the extractor sigil).",
  NolaContextualBindingReserved:
    "NOLA1014: `var .x` is reserved — a contextual binding is `const .x` or `let .x`.",
  NolaUnknownExtractorKind: "NOLA1016: `..x` — expected `choice`, `scale` or `prob` before the prompt template.",
  NolaAskTemplateNeedsSpace:
    "NOLA1017: the implied extractor needs whitespace before its template — write `ask `…`` (`ask`…`` reads as a tagged template).",
  // No code prefix: this is the ordinary syntax error (NOLA1001), worded the
  // way TypeScript words it — only its recovery is ours.
  NolaExpectedExpression: "expected an expression.",
});

export default (superClass: typeof Parser) =>
  class NolaParserMixin extends superClass {
    // Set for the duration of a single parseFunctionParams call when we are
    // inside a method (see parseMethod). Consumed-and-reset at the top of
    // parseFunctionParams so it never leaks into the method body.
    nolaInMethod = false;

    // Span of a just-consumed `infer` keyword, pending attachment to the
    // FunctionDeclaration parsed immediately after. Consumed-and-reset in
    // parseFunctionParams.
    nolaPendingInfer: { start: number; end: number } | null = null;

    // True while parsing the parameter list of an infer function (save/restore
    // across nested function-expression params in default values).
    nolaInInferParams = false;

    // One entry per template literal being parsed (outermost first). A
    // `${.member}` hole marks EVERY enclosing literal, so an instruction site
    // learns about scope access at any nesting depth (inside a .map callback's
    // own template literal, say). Depth > 0 is what makes a leading dot in
    // expression position a scope access instead of a syntax error.
    nolaTemplateStack: Array<{ scopeAccess: boolean }> = [];

    // The parser state and position the missing-expression placeholder was
    // last minted on (see parseExprAtom). The placeholder consumes nothing, so
    // the recovery must not repeat on the SAME state at the SAME position or a
    // loop that keeps asking for an expression there (an unclosed block at EOF)
    // would never end — while a tryParse rollback (the typescript mixin tries
    // `<T>` as arrow type parameters before a type assertion) swaps in a fresh
    // state object and legitimately asks again at that position, and a later
    // `const b = ;` in the same file is a different position on the same state.
    nolaMissingExpressionState: object | null = null;
    nolaMissingExpressionPos = -1;

    parseTemplate(isTagged: boolean): N.TemplateLiteral {
      const entry = { scopeAccess: false };
      this.nolaTemplateStack.push(entry);
      try {
        const node = super.parseTemplate(isTagged);
        if (entry.scopeAccess) (node as unknown as { nolaHasScopeAccess: boolean }).nolaHasScopeAccess = true;
        return node;
      } finally {
        this.nolaTemplateStack.pop();
      }
    }

    // `${.member}` — scope access. Only reached inside a template hole (see
    // parseExprAtom); `..` tokenizes as nolaDotDot, so an inner extractor in a
    // hole never lands here. Keyword members (`.default`) are legal: the
    // identifier is parsed liberally like any property name.
    nolaParseScopeAccess(): N.Expression {
      const node = this.startNode() as unknown as { property: unknown; nolaError?: boolean };
      const startLoc = this.state.startLoc;
      this.next(); // consume `.`
      for (const t of this.nolaTemplateStack) t.scopeAccess = true;
      if (tokenIsKeywordOrIdentifier(this.state.type)) {
        node.property = this.parseIdentifier(true);
      } else {
        // Tolerant: `${.` mid-keystroke recovers into a placeholder the lowering
        // still prefixes with the scope parameter (so TS answers completion after
        // the dot). Strict: raise throws.
        this.raise(NolaErrors.NolaIncompleteScopeAccess, startLoc);
        node.property = null;
        node.nolaError = true;
      }
      return this.finishNode(node as never, "NolaScopeAccess" as never);
    }

    // `infer function` at statement / export position. `infer` tokenizes as the
    // keyword-like tt._infer, and we only claim it when the NEXT token is
    // `function` — every other use of `infer` (identifier, TS conditional-type
    // keyword) stays untouched and falls through to super.
    nolaMaybeConsumeInfer(): void {
      if (!this.match(tt._infer)) return;
      if (this.lookahead().type !== tt._function) return;
      const start = this.state.start;
      this.next(); // consume `infer`
      this.nolaPendingInfer = { start, end: this.state.start };
    }

    parseStatementContent(flags: ParseStatementFlag, decorators?: N.Decorator[] | null): N.Statement {
      this.nolaMaybeConsumeInfer();
      return super.parseStatementContent(flags, decorators);
    }

    // An infer function body must parse in async context so `await` is legal
    // inside it (the lowering wraps the body in an async executor). Add the
    // Async production flag when an infer is pending. This marks
    // node.async = true in the AST, but the lowering emits plain
    // `function name(...)` text regardless, so nothing downstream shifts.
    parseFunction<T extends N.NormalFunction>(
      node: Undone<T>,
      flags: ParseFunctionFlag = ParseFunctionFlag.Expression,
    ): T {
      const f = this.nolaPendingInfer ? flags | ParseFunctionFlag.Async : flags;
      return super.parseFunction(node, f);
    }

    // Without this, `export infer function` is not recognized as a declaration
    // start (infer is tt._infer), so the export path falls to specifier parsing
    // and errors expecting `{`. Predicate only — the actual consume happens in
    // parseExportDeclaration below.
    shouldParseExportDeclaration(): boolean {
      if (this.match(tt._infer) && this.lookahead().type === tt._function) return true;
      return super.shouldParseExportDeclaration();
    }

    parseExportDeclaration(
      node: Undone<N.ExportNamedDeclaration>,
    ): N.ExportNamedDeclaration["declaration"] | undefined {
      this.nolaMaybeConsumeInfer();
      return super.parseExportDeclaration(node);
    }

    // ".." (exactly two dots) becomes tt.nolaDotDot. "..." keeps hitting the
    // super ellipsis path; `1..toString()` never reaches here because the
    // number reader consumes `1.` wholesale.
    readToken_dot(): void {
      const next = this.input.charCodeAt(this.state.pos + 1);
      const next2 = this.input.charCodeAt(this.state.pos + 2);
      if (next === charCodes.dot && next2 !== charCodes.dot) {
        this.state.pos += 2;
        this.finishToken(tt.nolaDotDot);
        return;
      }
      super.readToken_dot();
    }

    // A `.` standing where an extractor is being typed: consume it and hand
    // back the broken-extract placeholder (nolaError), which the lowering
    // replaces with an inert expression.
    nolaIncompleteExtract(): N.Expression {
      const node = this.startNode() as unknown as {
        quasi: unknown;
        prompt: string;
        typeArgs: unknown;
        nolaError: boolean;
      };
      const startLoc = this.state.startLoc;
      this.next(); // consume the lone `.`
      this.raise(NolaErrors.NolaExpectedPromptTemplate, startLoc);
      node.quasi = null;
      node.prompt = "";
      node.typeArgs = null;
      node.nolaError = true;
      return this.finishNode(node as never, "NolaExtractExpression" as never);
    }

    // The expression missing where the parser stands: `const x =` at the end
    // of the file or before a `;`, a `<T>` type assertion with nothing after
    // it (the `;` slipped in before an extractor's type args), `f(, a)`. A
    // zero-width placeholder right after the last token — where the operand
    // belongs, and where the diagnostic lands rather than on the closer (or
    // the trailing blank line the EOF token sits on). Same placeholder node
    // as the marker recoveries: the lowering replaces it with the inert
    // expression under a `broken` span.
    nolaMissingExpression(): N.Expression {
      const at = (this.state.lastTokEndLoc ?? this.state.startLoc) as Position;
      this.raise(NolaErrors.NolaExpectedExpression, at);
      const node = this.startNodeAt(at) as unknown as {
        quasi: unknown;
        prompt: string;
        typeArgs: unknown;
        nolaError: boolean;
      };
      node.quasi = null;
      node.prompt = "";
      node.typeArgs = null;
      node.nolaError = true;
      return this.finishNodeAt(node as never, "NolaExtractExpression" as never, at);
    }

    // `person.` with the name still being typed — the most common editor state
    // there is, and it carries no Nola construct at all. super reaches
    // parseIdentifier → unexpected(), which THROWS even under errorRecovery: the
    // whole file bails, the editor serves stale lowered output, and TypeScript
    // answers the `.`-triggered completion at a position that means nothing
    // with the global scope. TypeScript's own parser recovers this with a
    // missing identifier; do the same (zero-width placeholder property, the
    // dot's bytes stay verbatim) and record NOTHING: the lowered text keeps
    // `person.` for TypeScript to parse itself, so it completes the members
    // after the dot and reports its own "Identifier expected" through the
    // verbatim mapping, exactly as in a .ts file — a nola diagnostic here would
    // only double it. Strict mode is untouched (a build keeps the syntax error).
    parseMember(
      base: N.Expression | N.Super,
      startLoc: Position,
      state: N.ParseSubscriptState,
      computed: boolean,
      optional: boolean,
    ): N.OptionalMemberExpression | N.MemberExpression {
      if (
        !computed &&
        this.optionFlags & OptionFlags.ErrorRecovery &&
        !tokenIsKeywordOrIdentifier(this.state.type) &&
        !this.match(tt.privateName)
      ) {
        const node = this.startNodeAt(startLoc) as unknown as {
          object: unknown;
          computed: boolean;
          property: unknown;
          optional?: boolean;
        };
        node.object = base;
        node.computed = false;
        const at = this.state.lastTokEndLoc as Position; // right after the dot
        const placeholder = this.startNodeAt(at) as unknown as { name: string; nolaError: boolean };
        placeholder.name = "";
        placeholder.nolaError = true;
        node.property = this.finishNodeAt(placeholder as never, "Identifier" as never, at);
        if (state.optionalChainMember) {
          node.optional = optional;
          return this.finishNode(node as never, "OptionalMemberExpression" as never);
        }
        return this.finishNode(node as never, "MemberExpression" as never);
      }
      return super.parseMember(base, startLoc, state, computed, optional);
    }

    // The template-and-<T> tail shared by both extractor spellings: `..`
    // (node started at the sigil) and the implied form directly after `ask`
    // (node started at the backtick, see parseMaybeUnary).
    nolaFinishExtractor(node: { quasi: unknown; prompt: string; typeArgs: unknown }): N.Expression {
      // Babel's tokenizer never emits a bare backQuote: a `` ` `` becomes a
      // templateTail (no substitution) or templateNonTail (before `${`).
      if (!this.match(tt.templateTail) && !this.match(tt.templateNonTail)) {
        this.raise(NolaErrors.NolaExpectedPromptTemplate, this.state.startLoc);
        node.quasi = null;
        node.prompt = "";
        node.typeArgs = null;
        (node as unknown as { nolaError: boolean }).nolaError = true;
        return this.finishNode(node as never, "NolaExtractExpression" as never);
      }
      // `${...}` substitutions ARE allowed in extractor prompts (spliced at
      // lowering via __nola.fmt). Keep the parsed expressions on the quasi.
      const quasi = this.parseTemplate(false) as unknown as {
        expressions: unknown[];
        quasis: Array<{ value: { cooked: string | null; raw: string } }>;
      };
      node.quasi = quasi;
      node.prompt = quasi.quasis.map((q) => q.value.cooked ?? q.value.raw).join("");
      node.typeArgs = null;
      if (this.match(tt.lt)) {
        // After an extractor, `<` ALWAYS starts type args (documented rule).
        // Parenthesize — `(..`p`) < x` — to force a comparison instead.
        // tsParseTypeArguments is provided by the typescript mixin below us,
        // invisible on the base Parser type — hence the structural cast.
        node.typeArgs = (this as unknown as { tsParseTypeArguments(): unknown }).tsParseTypeArguments();
      }
      return this.finishNode(node as never, "NolaExtractExpression" as never);
    }

    parseExprAtom(refExpressionErrors?: ExpressionErrors | null): N.Expression | N.Super | N.Import {
      // `${.member}` inside a template hole: prompt-scope access.
      if (this.match(tt.dot) && this.nolaTemplateStack.length > 0) {
        return this.nolaParseScopeAccess();
      }
      // A lone `.` starting an expression is a `..` marker mid-keystroke —
      // nothing else in TS begins that way (`.5` tokenizes as a number, and a
      // member dot is consumed by parseSubscripts). Editor mode only: in a
      // build a stray dot is likelier a typo, and the ordinary syntax error
      // describes it better than "expected a prompt".
      if (this.match(tt.dot) && this.optionFlags & OptionFlags.ErrorRecovery) {
        return this.nolaIncompleteExtract();
      }
      // An expression expected where none can start: the end of the file, or
      // a token that closes or separates the enclosing construct — `const x =
      // ;`, `f(, a)`, and `ask `p`;<T>;` where the `;` slipped in before the
      // type args and the typescript mixin reads `<T>` as a type assertion
      // whose operand is the `;`. super reaches unexpected(), which THROWS
      // even under errorRecovery — the whole file bails and the editor serves
      // last-good output whose mappings describe an OLDER text (semantic
      // tokens on the wrong characters, the parse error dropped). TypeScript
      // recovers with a missing expression; do the same, ONCE per parser
      // state and position: a second visit at the same place on the same
      // state (an unclosed block's statement loop at EOF) reaches the throw
      // as before, so no loop is fed forever.
      if (
        this.optionFlags & OptionFlags.ErrorRecovery &&
        (this.match(tt.eof) ||
          this.match(tt.semi) ||
          this.match(tt.parenR) ||
          this.match(tt.braceR) ||
          this.match(tt.bracketR) ||
          this.match(tt.comma)) &&
        !(this.nolaMissingExpressionState === this.state && this.nolaMissingExpressionPos === this.state.start)
      ) {
        this.nolaMissingExpressionState = this.state;
        this.nolaMissingExpressionPos = this.state.start;
        return this.nolaMissingExpression();
      }
      if (this.match(tt.nolaDotDot)) {
        const node = this.startNode() as unknown as {
          quasi: unknown;
          prompt: string;
          typeArgs: unknown;
        };
        this.next(); // consume `..`
        // Bare `(..)` / `..,` derive-all call form — reserved for a future version.
        // Tolerant mode: record and return a placeholder the lowering skips.
        if (this.match(tt.parenR) || this.match(tt.comma)) {
          this.raise(NolaErrors.NolaReservedConstruct, this.state.startLoc);
          node.quasi = null;
          node.prompt = "";
          node.typeArgs = null;
          (node as unknown as { nolaError: boolean }).nolaError = true;
          return this.finishNode(node as never, "NolaExtractExpression" as never);
        }
        // `..choice` / `..scale` / `..prob` (decision types spec 2026-09-18 §5):
        // the primitive's name between the sigil and the template. Any other
        // identifier there is NOLA1016; tolerant mode drops it and parses the
        // extractor as plain so the editor keeps a construct to map.
        if (this.match(tt.name)) {
          const word = String(this.state.value);
          if (word === "choice" || word === "scale" || word === "prob") {
            (node as unknown as { kind: string }).kind = word;
          } else {
            this.raise(NolaErrors.NolaUnknownExtractorKind, this.state.startLoc);
          }
          this.next(); // consume the identifier
        }
        return this.nolaFinishExtractor(node);
      }
      return super.parseExprAtom(refExpressionErrors);
    }

    // `ask <unary>` — same precedence slot as await/typeof. `ask` stays a plain
    // identifier token (tt.name); we intercept by value so it never enters the
    // keyword table. `ask with <name> <unary>` routes the ask through a named
    // provider: `with` is a hard reserved word (tt._with, can never start an
    // expression), so the alias form needs no lookahead and cannot collide with
    // an operand identifier (`ask without` stays a plain ask).
    parseMaybeUnary(refExpressionErrors?: ExpressionErrors | null, sawUnary?: boolean): N.Expression {
      if (this.match(tt.name) && this.state.value === "ask") {
        const node = this.startNode() as unknown as { argument: unknown; provider: unknown };
        this.next(); // consume `ask`
        node.provider = null;
        if (this.match(tt._with)) {
          this.next(); // consume `with`
          // The alias must be a static word; it names a key of the config's
          // providers map, resolved at run time. Keywords are legal aliases —
          // config keys are arbitrary strings and the one guaranteed key is
          // the JS keyword `default`. Tolerant mode degrades to a plain ask
          // (provider stays null).
          if (!tokenIsKeywordOrIdentifier(this.state.type)) {
            this.raise(NolaErrors.NolaExpectedProviderName, this.state.startLoc);
          } else {
            node.provider = { name: this.state.value, start: this.state.start, end: this.state.end };
            this.next(); // consume the alias
          }
        }
        // Half-typed marker: `ask .` is the state between the two dots of
        // `ask ..`. A lone dot in expression position reaches parseExprAtom's
        // unexpected(), which THROWS even under errorRecovery, so the whole
        // file would bail and the editor would fall back to stale lowered
        // output. Consume the dot into the same placeholder the two-dot path
        // produces, so the rest of the file keeps parsing.
        if (this.match(tt.dot)) {
          node.argument = this.nolaIncompleteExtract();
        } else if (this.match(tt.templateTail) || this.match(tt.templateNonTail)) {
          // Implied sigil (spec 2026-09-18): a template literal as the FIRST
          // token of the operand is an extractor — a plain string could never
          // be asked, so the `..` carries no information here. Only the first
          // token: `ask (`x`)` and `ask tag`x`` stay plain expressions.
          // Subscripts (`.withRetry(2)`) attach to the extractor exactly as
          // parseExprAtom's `..` path hands them to parseSubscripts.
          // Whitespace is mandatory before the template (owner, 2026-09-19):
          // `ask`x`` and `ask with fast`x`` read as tagged templates. NOLA1017;
          // the operand still parses as the extractor so the file goes on.
          const startLoc = this.state.startLoc;
          if ((this.state.lastTokEndLoc as Position | null)?.index === startLoc.index) {
            this.raise(NolaErrors.NolaAskTemplateNeedsSpace, startLoc);
          }
          const extract = this.startNode() as unknown as { quasi: unknown; prompt: string; typeArgs: unknown };
          node.argument = this.parseSubscripts(this.nolaFinishExtractor(extract), startLoc);
        } else {
          node.argument = this.parseMaybeUnary(null, true);
        }
        return this.finishNode(node as never, "NolaAskExpression" as never);
      }
      return super.parseMaybeUnary(refExpressionErrors, sawUnary);
    }

    // Reserve `ask` in binding positions (const ask, params, imports…). Member
    // and property positions use parseIdentifier(liberal=true), which never
    // reaches checkReservedWord, so `o.ask` / `{ ask: 1 }` stay legal. Expression
    // positions are consumed by parseMaybeUnary above before they get here.
    checkReservedWord(word: string, startLoc: number, checkKeywords: boolean, isBinding: boolean): void {
      if (word === "ask") {
        // Record-and-return: skipping super avoids a cascading second error
        // on the same token. Strict mode throws inside raise() first.
        this.raise(NolaErrors.NolaAskReserved, startLoc);
        return;
      }
      super.checkReservedWord(word, startLoc, checkKeywords, isBinding);
    }

    // An instruction marker (template) may sit between the function name and `(`,
    // but ONLY on an `infer` function — on anything else it is NOLA1007.
    // `infer` on generators and methods is reserved (NOLA1004).
    parseFunctionParams(node: unknown, isConstructor?: boolean): void {
      const inMethod = this.nolaInMethod;
      this.nolaInMethod = false;
      const infer = this.nolaPendingInfer;
      this.nolaPendingInfer = null;
      const n = node as {
        generator?: boolean;
        nolaInfer?: { start: number; end: number };
        nolaMarker?: { start: number; end: number; instruction: string; quasi: unknown; hasScopeAccess: boolean };
      };
      if (infer) {
        if (n.generator || inMethod) {
          // Tolerant mode: keep parsing as a plain function (nolaInfer not
          // attached, so the lowering leaves the `infer` text in place).
          this.raise(NolaErrors.NolaReservedConstruct, infer.start);
        } else {
          n.nolaInfer = infer;
        }
      }
      if (this.match(tt.templateTail) || this.match(tt.templateNonTail)) {
        const markerStart = this.state.start;
        const tmpl = this.parseTemplate(false) as unknown as {
          end: number;
          expressions: unknown[];
          quasis: Array<{ value: { cooked: string | null; raw: string } }>;
          nolaHasScopeAccess?: boolean;
        };
        if (!infer) {
          // The template is already consumed, so parsing is resynchronized.
          this.raise(NolaErrors.NolaMarkerOutsideInfer, markerStart);
        } else {
          // Holes are legal (emit 11): lexical ones interpolate the instruction,
          // `${.member}` ones make the marker a prompt template. The cooked
          // instruction skips the holes; the lowering reads the quasi.
          const instruction = tmpl.quasis.map((q) => q.value.cooked ?? q.value.raw).join("");
          n.nolaMarker = {
            start: markerStart,
            end: tmpl.end,
            instruction,
            quasi: tmpl,
            hasScopeAccess: tmpl.nolaHasScopeAccess === true,
          };
        }
      }
      const prevInInferParams = this.nolaInInferParams;
      this.nolaInInferParams = Boolean(n.nolaInfer);
      try {
        // biome-ignore lint/suspicious/noExplicitAny: vendored superclass signature
        super.parseFunctionParams(node as any, isConstructor);
      } finally {
        this.nolaInInferParams = prevInInferParams;
      }
    }

    // `.name` context parameter. Claimed only at function-param positions
    // (IS_FUNCTION_PARAMS); array-pattern elements never see the flag. On a
    // non-infer function it is NOLA1010; on any non-identifier form (pattern,
    // default) it is NOLA1011 — both recover by parsing the element normally.
    // The retired `..name` spelling is NOLA1013 and otherwise behaves the same,
    // so tolerant mode gets one diagnostic instead of a bail.
    parseBindingElement(
      flags: ParseBindingListFlags,
      decorators: N.Decorator[],
    ): N.Pattern | N.Identifier | N.TSParameterProperty {
      const doubled = this.match(tt.nolaDotDot);
      if ((doubled || this.match(tt.dot)) && flags & ParseBindingListFlags.IS_FUNCTION_PARAMS) {
        const span = { start: this.state.start, end: this.state.end };
        const startLoc = this.state.startLoc;
        this.next(); // consume the marker
        if (doubled && this.nolaInInferParams) this.raise(NolaErrors.NolaContextualParamDoubleDot, startLoc);
        // Nothing to bind yet — the parameter name is still being typed. super
        // would reach unexpected(), which THROWS even under errorRecovery: the
        // whole file bails, the editor serves stale lowered output, and the
        // cursor maps through coordinates that mean nothing. Hand back a
        // placeholder the lowering replaces with nothing instead. A lone dot in
        // a parameter list is unambiguously the marker, so this reports the
        // nola error in strict mode too (where raise throws).
        if (this.nolaInInferParams && (this.match(tt.parenR) || this.match(tt.comma))) {
          this.raise(NolaErrors.NolaIncompleteContextualParam, startLoc);
          const placeholder = this.startNodeAt(startLoc) as unknown as { name: string; nolaError: boolean };
          // Reserved namespace, and offset-keyed so two placeholders in one
          // list cannot collide as duplicate parameter names. It never reaches
          // the generated text — the lowering replaces the whole span.
          placeholder.name = `__nola_incomplete_${span.start}`;
          placeholder.nolaError = true;
          return this.finishNode(placeholder as never, "Identifier" as never);
        }
        const elt = super.parseBindingElement(flags, decorators);
        if (!this.nolaInInferParams) {
          this.raise(NolaErrors.NolaContextualOutsideInfer, startLoc);
        } else if (elt.type === "Identifier") {
          (elt as { nolaContextual?: { start: number; end: number } }).nolaContextual = span;
        } else {
          this.raise(NolaErrors.NolaContextualParamReserved, startLoc);
        }
        return elt;
      }
      return super.parseBindingElement(flags, decorators);
    }

    // `const .x` / `let .x`: a contextual BINDING (scope-bodies spec §2.2) —
    // the marker span rides on the id as `nolaContextual`, exactly like a
    // parameter's; the lowerer judges the position (a scope body or not).
    // `..x` is the retired spelling (NOLA1013, recovers as contextual), a
    // pattern after the dot is NOLA1011, and `var .x` stays reserved
    // (NOLA1014: `var` hoists to undefined, which no ask should see) — its
    // span is parked as `nolaReservedMarker` so tolerant lowering drops it.
    parseVarId(decl: Undone<N.VariableDeclarator>, kind: "var" | "let" | "const" | "using" | "await using"): void {
      if (this.match(tt.dot) || this.match(tt.nolaDotDot)) {
        const span = { start: this.state.start, end: this.state.end };
        const startLoc = this.state.startLoc;
        const doubleDot = this.match(tt.nolaDotDot);
        this.next(); // consume the marker
        super.parseVarId(decl, kind);
        const id = decl.id as unknown as {
          type: string;
          nolaContextual?: { start: number; end: number };
          nolaReservedMarker?: { start: number; end: number };
        };
        if (kind === "var" || (kind !== "const" && kind !== "let")) {
          this.raise(NolaErrors.NolaContextualBindingReserved, startLoc);
          id.nolaReservedMarker = span;
          return;
        }
        if (id.type !== "Identifier") {
          this.raise(NolaErrors.NolaContextualParamReserved, startLoc);
          id.nolaReservedMarker = span;
          return;
        }
        if (doubleDot) this.raise(NolaErrors.NolaContextualParamDoubleDot, startLoc);
        id.nolaContextual = span;
        return;
      }
      super.parseVarId(decl, kind);
    }

    // `let` is contextual: Babel promotes it to a declaration keyword only when
    // the next character can start a binding. A `.` after `let` can only be the
    // (reserved) contextual-binding marker in a module — `let` is not a legal
    // identifier there, so `let.x` member access is already an error — so let it
    // through to parseVarId, which reports NOLA1014. Scoped to the `let` token
    // so no other binding-start probe changes.
    chStartsBindingIdentifier(ch: number, pos: number): boolean {
      if (ch === charCodes.dot && this.state.type === tt._let) return true;
      return super.chStartsBindingIdentifier(ch, pos);
    }

    // Flag method context so parseFunctionParams can reject markers on object methods.
    parseMethod<T extends N.ObjectMethod | N.ClassMethod | N.ClassPrivateMethod>(
      node: Undone<T>,
      isGenerator: boolean,
      isAsync: boolean,
      isConstructor: boolean,
      allowDirectSuper: boolean,
      type: T["type"],
      inClassScope?: boolean,
    ): T {
      this.nolaInMethod = true;
      return super.parseMethod(node, isGenerator, isAsync, isConstructor, allowDirectSuper, type, inClassScope);
    }

    // Class members reach isClassMethod() right after the member key. A marker
    // (`m``()`) leaves a template token there, which is never valid class syntax —
    // reject it as a reserved construct rather than a generic "unexpected token".
    isClassMethod(): boolean {
      if (this.match(tt.templateTail) || this.match(tt.templateNonTail)) {
        this.raise(NolaErrors.NolaReservedConstruct, this.state.startLoc);
        // Tolerant mode: consume the marker template to resynchronize, then
        // let the ordinary class-member parse continue at `(`.
        this.parseTemplate(false);
      }
      return super.isClassMethod();
    }

    // Bodiless functions (`declare function f``(): void;`) finish as
    // TSDeclareFunction with no `body` — reject a marker or infer on them.
    parseFunctionBodyAndFinish<
      T extends N.Function | N.TSDeclareMethod | N.TSDeclareFunction | N.ClassPrivateMethod,
    >(node: Undone<T>, type: T["type"], isMethod?: boolean): T {
      const finished = super.parseFunctionBodyAndFinish(node, type, isMethod) as T & {
        nolaMarker?: { start: number };
        nolaInfer?: { start: number };
        body?: unknown;
      };
      if ((finished.nolaMarker || finished.nolaInfer) && !finished.body) {
        const anchor = finished.nolaMarker ?? finished.nolaInfer;
        this.raise(NolaErrors.NolaReservedConstruct, (anchor as { start: number }).start);
        // Tolerant mode: strip the nola fields so downstream sees a plain
        // TSDeclareFunction (the invalid `infer`/marker text stays in source).
        delete finished.nolaMarker;
        delete finished.nolaInfer;
      }
      return finished;
    }
  };
