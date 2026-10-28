import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { createOnigScanner, createOnigString, loadWASM } from "vscode-oniguruma";
import { type IGrammar, INITIAL, type IRawGrammar, Registry, type StateStack } from "vscode-textmate";

// The grammars are only ever observed in an editor, so this suite runs them
// the way VS Code does: vscode-textmate over Oniguruma, the injection wired
// from the manifest's `injectTo`, and VS Code's own TypeScript grammar
// (fixtures/, see VENDOR.md) serving `source.ts` — the Nola rules only mean
// something next to TypeScript's, which scope every type, name and bracket.

const pkgDir = dirname(dirname(fileURLToPath(import.meta.url)));
const require = createRequire(import.meta.url);

interface GrammarContribution {
  scopeName: string;
  path: string;
  injectTo?: string[];
}

const manifest = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8"));
const contributions: GrammarContribution[] = manifest.contributes?.grammars ?? [];
const grammarFiles = new Map<string, string>([
  ...contributions.map((g): [string, string] => [g.scopeName, join(pkgDir, g.path)]),
  ["source.ts", join(pkgDir, "test", "fixtures", "TypeScript.tmLanguage.json")],
]);

let grammar: IGrammar;

beforeAll(async () => {
  await loadWASM(readFileSync(require.resolve("vscode-oniguruma/release/onig.wasm")));
  const registry = new Registry({
    onigLib: Promise.resolve({ createOnigScanner, createOnigString }),
    loadGrammar: async (scopeName) => {
      const file = grammarFiles.get(scopeName);
      return file ? (JSON.parse(readFileSync(file, "utf8")) as IRawGrammar) : null;
    },
    getInjections: (scopeName) => contributions.filter((g) => g.injectTo?.includes(scopeName)).map((g) => g.scopeName),
  });
  grammar = (await registry.loadGrammar("source.tsi")) as IGrammar;
});

interface Token {
  text: string;
  scopes: string[];
}

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let state: StateStack = INITIAL;
  for (const line of source.split("\n")) {
    const result = grammar.tokenizeLine(line, state);
    for (const t of result.tokens) tokens.push({ text: line.slice(t.startIndex, t.endIndex), scopes: t.scopes });
    state = result.ruleStack;
  }
  return tokens;
}

/** The scopes of the token whose text is exactly `text` (the nth such token). */
function scopesOf(source: string, text: string, nth = 0): string[] {
  const token = tokenize(source).filter((t) => t.text === text)[nth];
  if (!token) throw new Error(`no token ${JSON.stringify(text)} in ${JSON.stringify(source)}:\n${JSON.stringify(tokenize(source), null, 1)}`);
  return token.scopes;
}

describe("grammar contributions", () => {
  it("registers the nola grammar and injects the keyword grammar into it", () => {
    expect(contributions.map((g) => [g.scopeName, g.injectTo])).toEqual([
      ["source.tsi", undefined],
      ["source.tsi.nola-keywords", ["source.tsi"]],
    ]);
  });
});

// A colon glued to an extractor's closing backtick types it (spec 2026-09-23);
// since the tool-use spec (2026-10-08) a bracketed tool list may stand between
// the two, and the type follows the list — `]: T` glued, like the backtick
// rule, `]<T>` always. The type must read as a type annotation in both
// spellings, not as the expression TypeScript's grammar would otherwise see.
describe("the type of an extractor", () => {
  it("a glued `: T` after the template is a type annotation", () => {
    const scopes = scopesOf("const files = ask `the files`: string[];", "string");
    expect(scopes).toContain("meta.type.annotation.ts");
    expect(scopes).toContain("support.type.primitive.ts");
  });

  it("`<T>` after the template is the type arguments", () => {
    const scopes = scopesOf("const files = ask `the files`<string[]>;", "string");
    expect(scopes).toContain("meta.type.parameters.ts");
    expect(scopes).toContain("support.type.primitive.ts");
  });

  it("a glued `: T` after a tool list is a type annotation", () => {
    const scopes = scopesOf("const files = ask `the files` [searchFiles, readFile]: string[];", "string");
    expect(scopes).toContain("meta.type.annotation.ts");
    expect(scopes).toContain("support.type.primitive.ts");
    expect(scopes).not.toContain("variable.other.readwrite.ts");
  });

  it("a named type after a tool list is a type reference", () => {
    const scopes = scopesOf("const files = ask `the files` [searchFiles, fs.readFile,]: File[];", "File");
    expect(scopes).toContain("meta.type.annotation.ts");
    expect(scopes).toContain("entity.name.type.ts");
  });

  it("`<T>` after a tool list is the type arguments", () => {
    const scopes = scopesOf("const files = ask `the files` [searchFiles] <string[]>;", "string");
    expect(scopes).toContain("meta.type.parameters.ts");
    expect(scopes).toContain("support.type.primitive.ts");
  });

  it("the type after a tool list that spans lines is a type annotation", () => {
    const source = ["const files = ask `the files` [", "  searchFiles,", "  fs.readFile,", "]: string[];"].join("\n");
    const scopes = scopesOf(source, "string");
    expect(scopes).toContain("meta.type.annotation.ts");
    expect(scopes).toContain("support.type.primitive.ts");
  });

  it("an empty list — the state while its first entry is typed — still types what follows", () => {
    const scopes = scopesOf("const files = ask `the files` []: string[];", "string");
    expect(scopes).toContain("meta.type.annotation.ts");
    expect(scopes).toContain("support.type.primitive.ts");
  });

  it("an unclosed list ends where the parser's recovery ends it — before `)`, `;` or `}`", () => {
    const scopes = scopesOf("f(ask `p` [) + 1;", "1");
    expect(scopes).toContain("constant.numeric.decimal.ts");
    expect(scopes).not.toContain("meta.tools.nola");
  });

  it("the tool list keeps TypeScript's scoping for its entries, under meta.tools.nola", () => {
    const source = "const files = ask `the files` [searchFiles, fs.readFile]: string[];";
    expect(scopesOf(source, "[")).toEqual(expect.arrayContaining(["meta.tools.nola", "punctuation.definition.tools.begin.nola"]));
    expect(scopesOf(source, "searchFiles")).toEqual(expect.arrayContaining(["meta.tools.nola", "variable.other.readwrite.ts"]));
    expect(scopesOf(source, "readFile")).toEqual(expect.arrayContaining(["meta.tools.nola", "variable.other.property.ts"]));
    expect(scopesOf(source, "]")).toEqual(expect.arrayContaining(["meta.tools.nola", "punctuation.definition.tools.end.nola"]));
    expect(scopesOf(source, "string")).not.toContain("meta.tools.nola");
  });

  // The spaced colon (colon-typed spec, amendment 2026-10-12: a colon on the
  // closer's line is the type, glued or not). The grammar cannot see the
  // `ask` an extractor follows, so it follows the parser only where a
  // ternary's alternate cannot be mistaken for a type: after a list's `]`
  // outright (the list already committed the construct), and after a
  // backtick only when a primitive type keyword follows — `ok ? `yes` : `no``
  // and `ok ? `a` : fallback` keep TypeScript's coloring. A named type after a
  // spaced backtick colon is left to TypeScript too: its identifier is
  // colored by the semantic tokens through the anchor mapping, which a
  // primitive keyword never gets — hence the keyword gate.
  describe("a spaced `: T`", () => {
    it("after a tool list is a type annotation, on one line and after a list that spans lines", () => {
      const oneLine = scopesOf("const files = ask `the files` [searchFiles] : string[];", "string");
      expect(oneLine).toContain("meta.type.annotation.ts");
      expect(oneLine).toContain("support.type.primitive.ts");
      expect(oneLine).not.toContain("meta.tools.nola");
      const multi = ["const files = ask `the files` [", "  searchFiles,", "  readFile", "] : string[];"].join("\n");
      const scopes = scopesOf(multi, "string");
      expect(scopes).toContain("meta.type.annotation.ts");
      expect(scopes).toContain("support.type.primitive.ts");
    });

    it("after the template is a type annotation when a primitive type keyword follows", () => {
      for (const [source, word] of [
        ["const files = ask `the files` : string[];", "string"],
        ["const n = ask `how many` : number;", "number"],
        ["const i = ..`the id`\t: boolean;", "boolean"],
      ]) {
        const scopes = scopesOf(source, word);
        expect(scopes, source).toContain("meta.type.annotation.ts");
        expect(scopes, source).toContain("support.type.primitive.ts");
      }
    });

    it("after the template followed by anything else is left to TypeScript — a ternary's alternate keeps its coloring", () => {
      expect(scopesOf("const v = ok ? `yes` : `no`;", "no")).not.toContain("meta.type.annotation.ts");
      const alternate = scopesOf("const v = ok ? `a` : fallback;", "fallback");
      expect(alternate).not.toContain("meta.type.annotation.ts");
      expect(alternate).toContain("variable.other.readwrite.ts");
      // a named type here is colored by the semantic tokens, not the grammar
      expect(scopesOf("const r = ask `the result` : Result;", "Result")).not.toContain("meta.type.annotation.ts");
    });

    it("after a bracket in a ternary is read as the type, the grammar's approximation after a list", () => {
      const scopes = scopesOf("const v = ok ? `a`[0] : fallback;", "fallback");
      expect(scopes).toContain("meta.type.annotation.ts");
    });
  });

  it("a template index followed by anything else leaves the rest to TypeScript", () => {
    const scopes = scopesOf("const c = `abc`[0] + 1;", "1");
    expect(scopes).toContain("constant.numeric.decimal.ts");
    expect(scopes).not.toContain("meta.tools.nola");
  });

  it("a spread entry keeps the spread operator's scope and the type after the list", () => {
    const source = "const files = ask `read the files` [...fileTools]: string[];";
    expect(scopesOf(source, "...")).toEqual(expect.arrayContaining(["meta.tools.nola", "keyword.operator.spread.ts"]));
    expect(scopesOf(source, "string")).toContain("meta.type.annotation.ts");
  });

  // The ask sequence (spec 2026-10-12 §3.12): every list and type rule begins
  // after a closing backtick, so it fires after any text of the sequence.
  it("an ask sequence: a list after any text, the type after the last", () => {
    const source = "const files = ask `find` [searchFiles] `or` [readDir] `done`: string[];";
    expect(scopesOf(source, "[", 0)).toEqual(expect.arrayContaining(["meta.tools.nola"]));
    expect(scopesOf(source, "[", 1)).toEqual(expect.arrayContaining(["meta.tools.nola"]));
    expect(scopesOf(source, "readDir")).toEqual(expect.arrayContaining(["meta.tools.nola", "variable.other.readwrite.ts"]));
    expect(scopesOf(source, "string")).toEqual(expect.arrayContaining(["meta.type.annotation.ts"]));
    expect(scopesOf(source, "string")).not.toContain("meta.tools.nola");
  });

  it("a bare value between texts is ordinary TypeScript; the glued type after the last text is the extractor's", () => {
    const source = "const r = ask `use` admin `and` cfg.defaults `go`: Result;";
    expect(scopesOf(source, "admin")).toEqual(expect.arrayContaining(["variable.other.readwrite.ts"]));
    expect(scopesOf(source, "defaults")).toEqual(expect.arrayContaining(["variable.other.property.ts"]));
    expect(scopesOf(source, "Result")).toEqual(expect.arrayContaining(["meta.type.annotation.ts"]));
  });

  // The line rule (ask-sequence spec, amendment 2026-10-15): a line break
  // alone never ends an ask sequence, so a list or the type may stand on the
  // line after a text, and the type on the line after a list. TextMate reads
  // one line at a time, so a rule anchored on the closing backtick cannot see
  // it from the next line: a backtick that ends its line opens a
  // continuation instead, in which the next line's leading `[` is a list,
  // `<T>` is the type arguments and `: T` is the type under the same
  // primitive-keyword gate as the spaced colon; a list that ends its line
  // carries over the same way, with the colon ungated after its `]`. Any
  // other line ends the continuation where it starts, and a blank line is
  // skipped — the parser skips it too.
  describe("across lines", () => {
    const primitive = (source: string, word: string) => {
      const scopes = scopesOf(source, word);
      expect(scopes, source).toContain("meta.type.annotation.ts");
      expect(scopes, source).toContain("support.type.primitive.ts");
      expect(scopes, source).not.toContain("variable.other.readwrite.ts");
    };

    it("a list on the line after the text, typed on its own line", () => {
      const source = ["const files = ask `the files on disc D` ", "[searchFiles, readFile]: string[];"].join("\n");
      expect(scopesOf(source, "[")).toEqual(expect.arrayContaining(["meta.tools.nola", "punctuation.definition.tools.begin.nola"]));
      expect(scopesOf(source, "readFile")).toEqual(expect.arrayContaining(["meta.tools.nola", "variable.other.readwrite.ts"]));
      expect(scopesOf(source, "]")).toEqual(expect.arrayContaining(["meta.tools.nola", "punctuation.definition.tools.end.nola"]));
      primitive(source, "string");
    });

    it("the type on its own line after the text — `: T` with a primitive, `<T>` always", () => {
      primitive(["const files = ask `the files`", "  : string[];"].join("\n"), "string");
      const scopes = scopesOf(["const n = ask `how many`", "  <number>;"].join("\n"), "number");
      expect(scopes).toContain("meta.type.parameters.ts");
      expect(scopes).toContain("support.type.primitive.ts");
      const named = scopesOf(["const u = ask `the user`", "  <User>;"].join("\n"), "User");
      expect(named).toContain("meta.type.parameters.ts");
      expect(named).toContain("entity.name.type.ts");
    });

    it("the type on its own line after a list — on the list's line, after a list that spans lines, and after a list on the text's line", () => {
      primitive(["const files = ask `the files`", "  [searchFiles, readFile]", "  : string[];"].join("\n"), "string");
      primitive(["const files = ask `the files`", "[", "  searchFiles,", "  readFile,", "]", "  : string[];"].join("\n"), "string");
      primitive(["const files = ask `the files` [", "  searchFiles,", "  readFile,", "]", "  : string[];"].join("\n"), "string");
      const named = scopesOf(["const files = ask `the files`", "[searchFiles]", ": File[];"].join("\n"), "File");
      expect(named).toContain("meta.type.annotation.ts");
      expect(named).toContain("entity.name.type.ts");
      const args = scopesOf(["const files = ask `the files`", "[searchFiles]", "<string[]>;"].join("\n"), "string");
      expect(args).toContain("meta.type.parameters.ts");
      expect(args).toContain("support.type.primitive.ts");
    });

    it("a blank line between the parts is skipped", () => {
      primitive(["const files = ask `the files`", "", "[searchFiles, readFile]", "", "  : string[];"].join("\n"), "string");
    });

    it("the sequence goes on after a list on the next line, and the code after the ask is TypeScript's again", () => {
      const source = ["const files = ask `find`", "  [searchFiles] `then summarize` user `done`: string[];", "console.log(files);"].join("\n");
      expect(scopesOf(source, "then summarize")).toEqual(expect.arrayContaining(["string.template.ts"]));
      expect(scopesOf(source, "user")).toEqual(expect.arrayContaining(["variable.other.readwrite.ts"]));
      primitive(source, "string");
      expect(scopesOf(source, "log")).toEqual(expect.arrayContaining(["meta.function-call.ts", "entity.name.function.ts"]));
      const typed = ["const files = ask `the files`", "  : string[];", "console.log(files);"].join("\n");
      expect(scopesOf(typed, "log")).toEqual(expect.arrayContaining(["meta.function-call.ts", "entity.name.function.ts"]));
      const listed = ["const files = ask `the files`", "[searchFiles, readFile]", "console.log(files);"].join("\n");
      expect(scopesOf(listed, "log")).toEqual(expect.arrayContaining(["meta.function-call.ts", "entity.name.function.ts"]));
    });

    // A bare value between a text and the type (2026-10-16: `` `use this
    // config` searchConfig: string[] `` colored `string` as a variable). The
    // grammar cannot see `ask`, but a template followed by a space and an
    // identifier, a `(`, a `{`, a digit or a quote on the same line is a Nola
    // shape and nothing else — TypeScript puts only `in`, `instanceof`, `as`,
    // `satisfies` and `extends` there — so the value rule begins after the
    // text, scopes the value with TypeScript's expression rules, takes a
    // colon that no nested expression consumed as the type, and ends before
    // the next text, a closer, or the start of a line that is not the type.
    describe("a `: T` after a bare value", () => {
      it("after a value on a text's line — the reported layout, and on one line", () => {
        const source = [
          "const files = ask `the files on disc D that belong to a US visa application` ",
          "  [searchFiles, readFile]",
          "  `use this config` searchConfig: string[];",
          "",
          "console.log(JSON.stringify(files));",
        ].join("\n");
        expect(scopesOf(source, "searchConfig")).toEqual(expect.arrayContaining(["variable.other.readwrite.ts"]));
        primitive(source, "string");
        expect(scopesOf(source, "log")).toEqual(expect.arrayContaining(["meta.function-call.ts"]));
        primitive("const files = ask `the files` searchConfig: string[];", "string");
        primitive("const n = ask `how many` cfg.limit : number;", "number");
        const named = scopesOf("const r = ask `the result` input : Result;", "Result");
        expect(named).toContain("meta.type.annotation.ts");
        expect(named).toContain("entity.name.type.ts");
      });

      it("the type on the line after the value, with or without a blank line between", () => {
        primitive(["const files = ask `the files` searchConfig", "  : string[];"].join("\n"), "string");
        primitive(["const files = ask `the files` searchConfig", "", "  : string[];"].join("\n"), "string");
      });

      it("the value keeps TypeScript's scoping, a colon of its own included, and the next text is a string again", () => {
        const source = "const r = ask `use` cfg.defaults `go`: Result;";
        expect(scopesOf(source, "defaults")).toEqual(expect.arrayContaining(["variable.other.property.ts"]));
        expect(scopesOf(source, "go")).toEqual(expect.arrayContaining(["string.template.ts"]));
        expect(scopesOf(source, "Result")).toEqual(expect.arrayContaining(["meta.type.annotation.ts", "entity.name.type.ts"]));
        const ternary = "const r = ask `use` ok ? a : fallback `go`: string;";
        expect(scopesOf(ternary, "fallback")).toEqual(expect.arrayContaining(["variable.other.readwrite.ts"]));
        expect(scopesOf(ternary, "fallback")).not.toContain("meta.type.annotation.ts");
        primitive(ternary, "string");
        const object = "const r = ask `use` { verbose: true } `go`: string;";
        expect(scopesOf(object, "verbose")).toEqual(expect.arrayContaining(["meta.object-literal.key.ts"]));
        primitive(object, "string");
        // a call intent as the value: its slot's own type still reads as a type
        primitive("const t = ask `words` createTicket(`title`: string, 2);", "string");
      });

      it("what TypeScript puts after a template on its line keeps its scoping", () => {
        expect(scopesOf("type A = `a` extends C ? D : E;", "extends")).toContain("storage.modifier.ts");
        expect(scopesOf("if (`x` in obj) {}", "in")).toContain("keyword.operator.expression.in.ts");
        expect(scopesOf("const y = `x` as const;", "as")).toContain("keyword.control.as.ts");
        expect(scopesOf("const z = `x` instanceof Y;", "instanceof")).toContain("keyword.operator.expression.instanceof.ts");
        // a semicolon-free statement after a value that ends its line
        expect(scopesOf(["const r = ask `use` cfg", "const t = 1"].join("\n"), "const", 1)).toContain("storage.type.ts");
      });
    });

    // The parser skips comments, so a comment between two parts — on its own
    // line, or trailing a text, a list's `]` or a value — must not end the
    // continuation the way a line with code does (2026-10-16: a commented-out
    // part between the list and the type colored `string` as a variable).
    describe("a comment between the parts", () => {
      it("a comment line between a list and the type, the reported layout, and between the text and a list", () => {
        const source = [
          "const files = ask `the files on disc D that belong to a US visa application` ",
          "  [searchFiles, readFile] ",
          "  // `use this config` searchConfig",
          "  : string[];",
        ].join("\n");
        primitive(source, "string");
        expect(scopesOf(source, "//")).toEqual(expect.arrayContaining(["comment.line.double-slash.ts"]));
        const beforeList = ["const files = ask `the files`", "  // the tools", "  [searchFiles]: string[];"].join("\n");
        expect(scopesOf(beforeList, "[")).toEqual(expect.arrayContaining(["meta.tools.nola"]));
        primitive(beforeList, "string");
        expect(scopesOf(beforeList, "//")).toEqual(expect.arrayContaining(["comment.line.double-slash.ts"]));
      });

      it("a comment trailing the text, the list's `]` or a value before a part on the next line", () => {
        const afterText = ["const files = ask `the files` // the text", "  [searchFiles]: string[];"].join("\n");
        expect(scopesOf(afterText, "[")).toEqual(expect.arrayContaining(["meta.tools.nola"]));
        primitive(afterText, "string");
        // the continuation's begin captures a trailing comment whole
        expect(scopesOf(afterText, "// the text")).toEqual(expect.arrayContaining(["comment.line.double-slash.ts"]));
        const afterList = ["const files = ask `the files` [searchFiles] // the tools", "  : string[];"].join("\n");
        primitive(afterList, "string");
        expect(scopesOf(afterList, "//")).toEqual(expect.arrayContaining(["comment.line.double-slash.ts"]));
        const afterValue = ["const files = ask `the files` searchConfig // the config", "  : string[];"].join("\n");
        primitive(afterValue, "string");
        expect(scopesOf(afterValue, "//")).toEqual(expect.arrayContaining(["comment.line.double-slash.ts"]));
      });

      it("a block comment on its own line between the parts", () => {
        primitive(["const files = ask `the files`", "  /* the type */", "  : string[];"].join("\n"), "string");
        primitive(["const files = ask `the files` [searchFiles]", "  /* the type */", "  : string[];"].join("\n"), "string");
      });

      it("a comment line after a template that ends its line does not swallow the statement after it", () => {
        const source = ["const s = `x`", "// a note", "const t = 1;"].join("\n");
        expect(scopesOf(source, "const", 1)).toContain("storage.type.ts");
        expect(scopesOf(source, " a note")).toEqual(expect.arrayContaining(["comment.line.double-slash.ts"]));
      });
    });

    it("a line that does not continue the ask is left to TypeScript", () => {
      // a semicolon-free statement after a template
      expect(scopesOf(["const s = `hello`", "const t = 1;"].join("\n"), "const", 1)).toContain("storage.type.ts");
      // a ternary whose template consequent ends its line
      const alternate = scopesOf(["const v = ok", "  ? `yes`", "  : fallback;"].join("\n"), "fallback");
      expect(alternate).not.toContain("meta.type.annotation.ts");
      expect(alternate).toContain("variable.other.readwrite.ts");
      expect(scopesOf(["const v = ok ? `yes`", "  : `no`;"].join("\n"), "no")).not.toContain("meta.type.annotation.ts");
      // a named type after the text is colored by the semantic tokens, as on one line
      const named = scopesOf(["const r = ask `the result`", "  : Result;"].join("\n"), "Result");
      expect(named).not.toContain("meta.type.annotation.ts");
      expect(named).toContain("variable.other.readwrite.ts");
      // a template that closes an object literal's last property
      expect(scopesOf(["const cfg = {", "  title: `hello`", "};", "const after = 1;"].join("\n"), "const", 1)).toContain("storage.type.ts");
    });
  });
});
