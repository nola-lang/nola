/**
 * NOLA PLUGIN — the reason this parser is vendored.
 * Adds (v2 surface):
 *  - `..`prompt`` extractor expressions, `${}` interpolation allowed; the `..`
 *    is implied directly after `ask` (spec 2026-09-18) and in a call's slots
 *    (spec 2026-09-30: a typed template that starts an argument, or a value
 *    nested in plain object/array literals there);
 *  - the `ask` unary operator;
 *  - `infer function` declarations (statement + export position); the marker
 *    slot between name and `(` is RESERVED — NOLA1019 (spec
 *    2026-09-26-body-instruction-only): the instruction is the body's first
 *    statement;
 *  - context statements (spec 2026-09-29): a bare template literal statement,
 *    a chain of adjacent literals, or text/value parts — claimed in
 *    parseExpressionStatement, where `` `a` user `` is "Missing semicolon" in
 *    every JavaScript parser, and in parseSubscript, where `` `a` [b] `` is an
 *    index on a string that no program means; continued only where JavaScript
 *    would not start a new statement (name-led lines stay new statements —
 *    the semicolon rules of the language, unchanged);
 *  - reserved-construct errors for bare `(..)` and generator/method infer
 *    functions.
 * Registered LAST-but-before-placeholders so it composes on top of the
 * typescript mixin (mixin order = key order in plugin-utils.ts).
 */
import * as charCodes from "charcodes";
import { OptionFlags } from "../../options.ts";
import { Errors, ParseErrorEnum } from "../../parse-error.ts";
import type Parser from "../../parser/index.ts";
import { ParseBindingListFlags } from "../../parser/lval.ts";
import type { Undone } from "../../parser/node.ts";
import { ParseFunctionFlag, type ParseStatementFlag } from "../../parser/statement.ts";
import type { ExpressionErrors } from "../../parser/util.ts";
import {
  type TokenType,
  tokenCanStartExpression,
  tokenIsIdentifier,
  tokenIsKeyword,
  tokenIsKeywordOrIdentifier,
  tokenIsTemplate,
  tt,
} from "../../tokenizer/types.ts";
import type * as N from "../../types.ts";
import type { Position } from "../../util/location.ts";

export const NolaErrors = ParseErrorEnum`nola`({
  NolaAskReserved: "NOLA1003: `ask` is a reserved word in .tsi files and cannot be used as an identifier.",
  NolaReservedConstruct: "NOLA1004: this Nola construct is reserved for a future Nola version.",
  NolaExpectedPromptTemplate: "NOLA1005: expected a template literal prompt after `..`.",
  NolaMarkerOutsideInfer:
    "NOLA1007: a marker after a plain function's name is not valid — only an `infer function` has that slot, and there it is reserved (NOLA1019).",
  NolaMarkerReserved:
    "NOLA1019: the marker after an infer function's name is reserved for a future Nola version — write the instruction as a context statement in the body: `…`.",
  NolaContextValueTail:
    "NOLA1020: a value in a context statement is a name, a call or a bracketed expression, followed by text or the end of the statement — wrap anything else in parentheses, or assign it to a local first (`await`, `ask` and `this` cannot be values).",
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
  NolaAskTemplateNeedsSpace:
    "NOLA1017: the implied extractor needs whitespace before its template — write `ask `…`` (`ask`…`` reads as a tagged template).",
  NolaExpectedExtractorType: "NOLA1018: expected a type after the extractor's `:` on the same line — write ``…`: T`.",
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

    // The start offset of the context-statement value being parsed (spec
    // 2026-09-29 §3.2), or null outside one. parseSubscript reads it: a
    // template right after the value's own base ends the value instead of
    // tagging it — `user `text`` is text after a value, `f(tag`x`)` keeps its
    // inner tag.
    nolaValueStart: number | null = null;

    // The start offset of the innermost statement that opens with a template
    // literal (spec 2026-09-29 §3.2), or null. parseSubscript reads it to tell
    // that statement's LEADING text from any other template literal: a `[` or
    // `(` right after the leading text starts the statement's first value, not
    // an index or a call on the string.
    nolaStatementStart: number | null = null;

    // The start offset of the slot item being parsed — an argument of a call,
    // or a property value / element of an object / array literal that is
    // itself a slot (spec 2026-09-30) — or -1. parseExprAtom reads it: a
    // typed template literal that STARTS such an item is an extractor with
    // the `..` implied, exactly the positions where the sigil-less call-intent
    // rule (2026-08-14) makes an extractor a slot. Position-keyed like
    // nolaValueStart: a template at any other offset — under an operator or a
    // spread, in a ternary, inside a nested function — is the string it
    // always was, and a stale value can never match a later token.
    nolaSlotStart = -1;

    // True while the items of a slot list are parsed: a call's arguments
    // (always), or an object / array literal whose opening token sits at
    // nolaSlotStart (so `f({ a: … })` nests, `f(x ? { a: … } : y)` does not).
    // Saved and restored around every list, and set to false for `new`'s
    // arguments — not a call, never a call intent.
    nolaInSlotList = false;

    nolaWithSlotList<T>(slots: boolean, parse: () => T): T {
      const prev = this.nolaInSlotList;
      this.nolaInSlotList = slots;
      try {
        return parse();
      } finally {
        this.nolaInSlotList = prev;
      }
    }

    parseCallExpressionArguments(
      allowPlaceholder?: boolean,
      nodeForExtra?: Undone<N.Node> | null,
      refExpressionErrors?: ExpressionErrors | null,
    ): (N.Expression | N.SpreadElement)[] {
      return this.nolaWithSlotList(true, () =>
        super.parseCallExpressionArguments(allowPlaceholder, nodeForExtra, refExpressionErrors),
      );
    }

    parseArrayLike(close: TokenType, refExpressionErrors?: ExpressionErrors | null): N.ArrayExpression {
      return this.nolaWithSlotList(this.state.start === this.nolaSlotStart, () =>
        super.parseArrayLike(close, refExpressionErrors),
      );
    }

    parseObjectLike<T extends N.ObjectPattern | N.ObjectExpression>(
      close: TokenType,
      isPattern: boolean,
      refExpressionErrors?: ExpressionErrors | null,
    ): T {
      return this.nolaWithSlotList(!isPattern && this.state.start === this.nolaSlotStart, () =>
        super.parseObjectLike<T>(close, isPattern, refExpressionErrors),
      );
    }

    parseNew(node: Undone<N.NewExpression>): N.NewExpression {
      return this.nolaWithSlotList(false, () => super.parseNew(node));
    }

    // A parenthesized group's items share the slot items' entry point but are
    // no slots: `f((`x`: T))` keeps the ordinary syntax error, as `ask (`x`)`
    // keeps a plain template — only a template that is an item's FIRST token
    // is claimed.
    parseParenAndDistinguishExpression(canStartArrow: boolean): N.Expression {
      return this.nolaWithSlotList(false, () => super.parseParenAndDistinguishExpression(canStartArrow));
    }

    // The one entry every slot item goes through: a call argument (via
    // parseExprListItem), an array element (the same) and an object property's
    // value (parseObjectProperty). A spread's operand takes another path, so a
    // spread is no slot — as in the lowerer's walk.
    parseMaybeAssignAllowInOrVoidPattern(
      close: TokenType,
      refExpressionErrors: ExpressionErrors | null | undefined,
      afterLeftParse?: Function,
    ): N.Expression {
      if (this.nolaInSlotList) this.nolaSlotStart = this.state.start;
      return super.parseMaybeAssignAllowInOrVoidPattern(close, refExpressionErrors, afterLeftParse);
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
      // A statement that opens with a template literal may be a context
      // statement: note where it starts so parseSubscript can tell its leading
      // text from any other template literal (spec 2026-09-29 §3.2).
      if (!tokenIsTemplate(this.state.type)) return super.parseStatementContent(flags, decorators);
      const prev = this.nolaStatementStart;
      this.nolaStatementStart = this.state.start;
      try {
        return super.parseStatementContent(flags, decorators);
      } finally {
        this.nolaStatementStart = prev;
      }
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
    //
    // Inside a context value (spec 2026-09-29), nested expressions included (an
    // arrow body in `items.map(...)`), the next line can be a statement that was
    // already below the line being typed: `` `Page` oncall. ⏎ return x; ``. A
    // keyword there is no property name, nor is a name or keyword that is
    // itself followed, on its own line, by another one (`let y`, `await foo`,
    // `type X`, `async function` — TypeScript's own rule for a dot at the end of
    // a line); a lone name (`user.` ⏎ `name`) stays a property. Outside a
    // context value every expression keeps today's parse.
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
        ((!tokenIsKeywordOrIdentifier(this.state.type) && !this.match(tt.privateName)) ||
          (this.nolaValueStart !== null && this.hasPrecedingLineBreak() && this.nolaStartsNextStatement()))
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

    // The token after a dot, on the next line, starts a statement rather than
    // naming a property: a keyword, or a name or keyword that is itself followed
    // on its own line by another one (tolerant mode, inside a context value).
    nolaStartsNextStatement(): boolean {
      const { type } = this.state;
      if (tokenIsKeyword(type)) return true;
      return (
        tokenIsKeywordOrIdentifier(type) && !this.hasFollowingLineBreak() && tokenIsKeywordOrIdentifier(this.lookahead().type)
      );
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
      } else if (this.match(tt.colon) && this.state.start === (this.state.lastTokEndLoc as Position).index) {
        node.typeArgs = this.nolaParseColonType();
      }
      return this.finishNode(node as never, "NolaExtractExpression" as never);
    }

    // `: T` after the template — the colon spelling of `<T>` (spec
    // 2026-09-23): one TypeScript type in type context, wrapped in the
    // TSTypeParameterInstantiation shape the `<T>` form yields (spanning the
    // colon to the type's end) so every consumer reads params[0] either way.
    // The colon must be GLUED to the closing backtick, like an annotation
    // (`` `p`: number ``): a colon after whitespace is never ours, which is
    // what keeps a ternary's own separator (`a ? ask `p` : b`, with the space
    // every formatter puts there) out of the type grammar without lookahead
    // or backtracking. The type must START ON THE COLON'S LINE: TypeScript's
    // type grammar reads across line breaks, so an unfinished `: ` above an
    // existing statement would take that statement's first expression as a
    // qualified type name and its call parens as a call on the extractor —
    // silently, in a build too. NOLA1018 instead; tolerant mode eats the
    // colon and leaves the extractor untyped so the file goes on parsing.
    nolaParseColonType(): unknown {
      const colonLoc = this.state.startLoc;
      this.next(); // consume `:` — the next token tokenizes the same in and out of type context
      if (
        this.hasPrecedingLineBreak() ||
        this.match(tt.eof) ||
        this.match(tt.semi) ||
        this.match(tt.parenR) ||
        this.match(tt.bracketR) ||
        this.match(tt.braceR) ||
        this.match(tt.comma)
      ) {
        this.raise(NolaErrors.NolaExpectedExtractorType, colonLoc);
        return null;
      }
      // tsParseTypeAnnotation(eatColon = false) parses one type inside tsInType;
      // provided by the typescript mixin below us — hence the structural cast.
      const ann = (this as unknown as { tsParseTypeAnnotation(eatColon: boolean): { typeAnnotation: unknown } }).tsParseTypeAnnotation(false);
      const inst = this.startNodeAt(colonLoc) as unknown as { params: unknown[] };
      inst.params = [ann.typeAnnotation];
      return this.finishNode(inst as never, "TSTypeParameterInstantiation" as never);
    }

    parseExprAtom(refExpressionErrors?: ExpressionErrors | null): N.Expression | N.Super | N.Import {
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
        return this.nolaFinishExtractor(node);
      }
      // Implied sigil in a call slot (spec 2026-09-30): a template literal that
      // STARTS a slot item is an extractor when a type follows it.
      if (tokenIsTemplate(this.state.type) && this.state.start === this.nolaSlotStart) {
        return this.nolaParseSlotTemplate();
      }
      return super.parseExprAtom(refExpressionErrors);
    }

    // A template literal at the start of a slot: parsed as the plain template
    // it is in TypeScript, then claimed as an extractor only when a type
    // follows — a `:` GLUED to the closing backtick (the colon spelling, with
    // its rules: nolaParseColonType), or `<…>` that TypeScript itself would
    // read as type arguments (nolaTryParseSlotTypeArgs). Untyped, it stays
    // the string argument it always was — `console.log(`hi`)` is ordinary
    // code, and an untyped slot would be NOLA2004 anyway. The node spans from
    // the backtick, like the implied form after `ask`; the lowerer inserts the
    // prefix in front of it and lowers both spellings identically.
    nolaParseSlotTemplate(): N.Expression {
      const startLoc = this.state.startLoc;
      const quasi = this.parseTemplate(false) as unknown as {
        quasis: Array<{ value: { cooked: string | null; raw: string } }>;
      };
      let typeArgs: unknown;
      if (this.match(tt.colon) && this.state.start === (this.state.lastTokEndLoc as Position).index) {
        // null on NOLA1018 (tolerant mode): untyped, still the extractor
        typeArgs = this.nolaParseColonType();
      } else if (this.match(tt.lt)) {
        typeArgs = this.nolaTryParseSlotTypeArgs();
        if (!typeArgs) return quasi as unknown as N.Expression;
      } else {
        return quasi as unknown as N.Expression;
      }
      const node = this.startNodeAt(startLoc) as unknown as { quasi: unknown; prompt: string; typeArgs: unknown };
      node.quasi = quasi;
      node.prompt = quasi.quasis.map((q) => q.value.cooked ?? q.value.raw).join("");
      node.typeArgs = typeArgs;
      return this.finishNode(node as never, "NolaExtractExpression" as never);
    }

    // `<…>` after a slot template, on TypeScript's own terms: type arguments
    // that parse and are not followed by a token that would make them part of
    // a comparison chain (`` f(`a` < b > c) ``), a call (`` `x`<T>(1) ``) or a
    // tagged template — the bail-outs of the typescript mixin's parseSubscript,
    // the code that reads the same text as an instantiation expression when
    // nothing claims it. Anything else is left to that path, so `` f(`a` < b) ``
    // stays the comparison it is. tsTryParseAndCatch restores the state on a
    // failed or abandoned attempt; both helpers come from the typescript mixin
    // below us — hence the structural cast.
    nolaTryParseSlotTypeArgs(): unknown {
      const ts = this as unknown as {
        tsTryParseAndCatch<T>(f: () => T | undefined): T | undefined;
        tsParseTypeArgumentsInExpression(): unknown;
      };
      return ts.tsTryParseAndCatch(() => {
        const typeArgs = ts.tsParseTypeArgumentsInExpression();
        if (!typeArgs) return undefined;
        const { type } = this.state;
        if (
          type === tt.gt ||
          type === tt.bitShiftR ||
          type === tt.parenL ||
          tokenIsTemplate(type) ||
          (type !== tt._as && type !== tt._satisfies && tokenCanStartExpression(type) && !this.hasPrecedingLineBreak())
        ) {
          return undefined;
        }
        return typeArgs;
      });
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

    // Context statements (spec 2026-09-29 §3.2). super would call semicolon()
    // and raise "Missing semicolon" at the identifier — a fatal raise, which
    // is why a half-typed `` `a` us `` used to bail the whole file. The
    // statement is claimed only when its expression is an unparenthesized
    // template literal or a chain of them (a string-tagged template always
    // throws at run time; no program means it). It goes on with what the loop
    // below takes — text (a template, on any line) and values (see
    // nolaStartsContextValue: a name, `new`, a literal or `{` on the same
    // line, `[` or `(` on any line — the tokens JavaScript would not insert a
    // semicolon before) — and ends where JavaScript ends a statement, so a
    // name-led next line stays a new statement.
    parseExpressionStatement(
      node: Undone<N.ExpressionStatement>,
      expr: N.Expression,
      decorators: N.Decorator[] | null | undefined,
    ): N.ExpressionStatement {
      const parts = this.nolaTemplateChain(expr);
      if (!parts) return super.parseExpressionStatement(node, expr, decorators);
      this.nolaCheckChainEscapes(parts);
      for (;;) {
        if (tokenIsTemplate(this.state.type)) {
          // text after anything — JS never inserts a semicolon before a template
          parts.push(this.parseTemplate(false) as N.Expression);
          continue;
        }
        const lastIsText = (parts[parts.length - 1] as N.Node).type === "TemplateLiteral";
        if (lastIsText && this.nolaStartsContextValue()) {
          parts.push(this.nolaParseContextValue());
          continue;
        }
        // `;` (eaten), `}`, EOF, or a line break: the statement ends here.
        if (this.isLineTerminator()) break;
        // Same line, a token that cannot continue the statement — an operator or
        // arrow after a value, `typeof`/`ask`/`function` after text. Record
        // NOLA1020 and end the statement BEFORE the token, which then begins
        // the next statement (tolerant mode goes on; strict mode has thrown).
        this.raise(NolaErrors.NolaContextValueTail, this.state.startLoc);
        break;
      }
      const ctx = node as unknown as { parts: N.Expression[] };
      ctx.parts = parts;
      return this.finishNode(node as never, "NolaContextStatement" as never) as unknown as N.ExpressionStatement;
    }

    // The text parts a statement's expression already holds: one unparenthesized
    // TemplateLiteral, or a TaggedTemplateExpression chain whose innermost tag
    // is one (`` `a` `` ⏎ `` `b` `` parses as `a` tagging `b` before we see it).
    // A tag with TypeScript type arguments (`` `a`<T>`b` ``) is not text: that
    // chain stays ordinary code, so no `<T>` bytes ever sit between two parts.
    // null for every other expression — those keep their meaning.
    nolaTemplateChain(expr: N.Expression): N.Expression[] | null {
      const parenthesized = (n: N.Node) => Boolean((n as { extra?: { parenthesized?: boolean } }).extra?.parenthesized);
      const chain: N.Expression[] = [];
      let cur: N.Node = expr;
      while (cur.type === "TaggedTemplateExpression") {
        if (parenthesized(cur) || (cur as { typeArguments?: unknown }).typeArguments) return null;
        chain.unshift((cur as N.TaggedTemplateExpression).quasi as N.Expression);
        cur = (cur as N.TaggedTemplateExpression).tag;
      }
      if (cur.type !== "TemplateLiteral" || parenthesized(cur)) return null;
      chain.unshift(cur as N.Expression);
      return chain;
    }

    // Text is a template literal in every position (spec 2026-09-29 §3.1). The
    // first part of a claimed chain was parsed as one, and Babel raised its bad
    // escapes itself; the continuation lines (`a` ⏎ `b`) were parsed as TAGGED
    // templates, where a bad escape is legal and its cooked text null — which
    // would reach __nola.ctx as undefined. Raise the same error at the element.
    // Here, once: nolaTemplateChain is also a predicate (parseSubscript).
    nolaCheckChainEscapes(parts: N.Expression[]): void {
      for (const text of parts.slice(1)) {
        for (const element of (text as unknown as N.TemplateLiteral).quasis) {
          if (element.value.cooked === null) this.raise(Errors.InvalidEscapeSequenceTemplate, element.loc.start);
        }
      }
    }

    // A value may start here: a name (never `ask` or `await`), `new`, a literal or
    // `{` on the SAME line; `[` or `(` on any line — exactly the tokens JavaScript
    // would not insert a semicolon before, so an identifier-led next line keeps
    // being a new statement. Never `this` (spec 2026-09-29 decision 2): every item
    // is a hoisted function with a `this` of its own — TS2683 at check time,
    // `undefined` at run time — so a bare `this` reaches NOLA1020 like `await` and
    // `ask`; the message says to assign it to a local first. (Parenthesized, or in
    // a `${}` hole, it is an ordinary expression and TypeScript reports it.)
    nolaStartsContextValue(): boolean {
      const { type } = this.state;
      if (type === tt.bracketL || type === tt.parenL) return true;
      if (this.hasPrecedingLineBreak()) return false;
      if ((type === tt.name && this.state.value === "ask") || type === tt._await) return false;
      return (
        tokenIsIdentifier(type) ||
        type === tt._new ||
        type === tt.braceL ||
        type === tt.num ||
        type === tt.string ||
        type === tt.bigint ||
        type === tt._true ||
        type === tt._false ||
        type === tt._null
      );
    }

    // One value: a left-hand-side expression (atom + member/call/index tails —
    // never an operator, an arrow or a ternary; those reach NOLA1020 above).
    // The value's start offset arms the stop rule in parseSubscript below; the
    // parsed value is checked afterwards, for what the stop rule cannot see.
    nolaParseContextValue(): N.Expression {
      const prev = this.nolaValueStart;
      const startLoc = this.state.startLoc;
      const start = this.state.start;
      this.nolaValueStart = start;
      try {
        const value = this.parseExprSubscripts();
        this.nolaCheckValue(value, startLoc);
        // The bytes the value owns, parentheses included: a parenthesized
        // expression's node spans the inner expression only, and the lowerer
        // must not eat the `(` or the `)` when it rewrites the seams.
        (value as unknown as { nolaValueSpan: { start: number; end: number } }).nolaValueSpan = {
          start,
          end: (this.state.lastTokEndLoc as Position).index,
        };
        return value;
      } finally {
        this.nolaValueStart = prev;
      }
    }

    // What a parsed value must not be. A value never ENDS with a template
    // literal — `` sql`select` `` is the value `sql` followed by text (the stop
    // rule), so a template at the end of the value's right spine is text the
    // value swallowed: after TypeScript's `f<T>` (its own branch builds the
    // tagged template) or as the callee of an argument-less `new` (its base
    // starts after the `new`). That is NOLA1020, at the swallowed text;
    // parenthesized, `(f<T>)` and `(new Foo)` stop where the text starts. A
    // function or class expression is no value either (the spec lists
    // `function` and `class`; `async function` gets in as an identifier) unless
    // parenthesized. Tolerant mode records it and keeps the value as parsed —
    // bytes verbatim, TypeScript still checks the tag call — and the statement
    // loop goes on.
    nolaCheckValue(value: N.Expression, startLoc: Position): void {
      const parenthesized = (n: N.Node) => Boolean((n as { extra?: { parenthesized?: boolean } }).extra?.parenthesized);
      if (
        (value.type === "FunctionExpression" ||
          value.type === "ClassExpression" ||
          value.type === "ArrowFunctionExpression") &&
        !parenthesized(value)
      ) {
        this.raise(NolaErrors.NolaContextValueTail, startLoc);
        return;
      }
      let cur: N.Node = value;
      while (!parenthesized(cur)) {
        if (cur.type === "TaggedTemplateExpression") {
          this.raise(NolaErrors.NolaContextValueTail, (cur as N.TaggedTemplateExpression).quasi.loc.start);
          return;
        }
        // an argument-less `new`: its callee ends where the expression ends
        if (cur.type !== "NewExpression" || (cur as N.NewExpression).callee.end !== cur.end) return;
        cur = (cur as N.NewExpression).callee;
      }
    }

    // Two rules meet in parseSubscript (spec 2026-09-29 §3.2); nolaCheckValue
    // covers what the first cannot see.
    //
    // The stop rule: while a context value is being parsed, a template right
    // after the value's OWN base (the expression that starts where the value
    // starts — `user`, `user.name`, `foo(x)`, `[a]`, `(x)`) ends the value
    // rather than tagging it. A base that starts later — `tag` inside `f(tag`x`)`
    // or `[tag`x`]` — is nested and keeps its tag. A parenthesized base carries
    // its `(` position in extra.parenStart; its own start is the inner one. Two
    // things get past it: TypeScript's `f<T>` branch parses the tagged template
    // itself (this override only ever meets the `<`), and the callee of an
    // argument-less `new` starts after the `new`, so it counts as nested; in
    // both the value swallows the text after it, and nolaCheckValue reports it.
    //
    // The leading-text rule: JavaScript parses `` `text` [a] `` and `` `text` (x) ``
    // as an index and a call ON the string, before parseExpressionStatement can
    // see the group. Neither means anything — a string is not callable and its
    // index is one character — and the spec gives a `[` or `(` after text to
    // the sequence (decision 3). So when a statement's leading text (one
    // template or a chain of them; parseStatementContent records where a
    // template-led statement starts, in nolaStatementStart) meets one, stop and
    // leave the group to the statement loop, which parses it as the first value
    // with its whole tail: `` `text` [a].length `` is the value `[a].length`.
    parseSubscript(
      base: N.Expression | N.Super | N.Import,
      startLoc: Position,
      noCalls: boolean | undefined | null,
      state: N.ParseSubscriptState,
    ): N.Expression {
      if (this.nolaValueStart !== null && tokenIsTemplate(this.state.type)) {
        const baseStart = (base as { extra?: { parenStart?: number } }).extra?.parenStart ?? base.start;
        if (baseStart === this.nolaValueStart) return this.stopParseSubscript(base as N.Expression, state);
      }
      if (
        this.nolaStatementStart === base.start &&
        (this.match(tt.bracketL) || this.match(tt.parenL)) &&
        this.nolaTemplateChain(base as N.Expression)
      ) {
        return this.stopParseSubscript(base as N.Expression, state);
      }
      return super.parseSubscript(base, startLoc, noCalls, state);
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

    // A marker (template) may sit between the function name and `(`. On a
    // plain function it is NOLA1007; on an infer function it is RESERVED —
    // NOLA1019 (spec 2026-09-26-body-instruction-only §3.1): the instruction
    // is a context statement in the body now, and the slot is kept for a later
    // design. Tolerant mode keeps the marker on the node so the lowering can
    // drop its bytes (the header must reach TypeScript without them).
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
        };
        if (!infer) {
          // The template is already consumed, so parsing is resynchronized.
          this.raise(NolaErrors.NolaMarkerOutsideInfer, markerStart);
        } else {
          this.raise(NolaErrors.NolaMarkerReserved, markerStart);
          const instruction = tmpl.quasis.map((q) => q.value.cooked ?? q.value.raw).join("");
          n.nolaMarker = {
            start: markerStart,
            end: tmpl.end,
            instruction,
            quasi: tmpl,
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
