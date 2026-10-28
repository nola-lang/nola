import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { compileNola, finalizeDerivations } from "@nola-lang/compiler";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { createDerivationService } from "../src/service.js";
import { DerivationError, deriveTool } from "../src/walk.js";

const REPO = fileURLToPath(new URL("../../..", import.meta.url)).replace(/\\/g, "/").replace(/\/$/, "");
const FILE = `${REPO}/packages/derive/test/fixtures/tools.ts`;
const program = ts.createProgram([FILE], {
  strict: true,
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.NodeNext,
  moduleResolution: ts.ModuleResolutionKind.NodeNext,
  skipLibCheck: true,
  noEmit: true,
  types: ["node"],
  typeRoots: [`${REPO}/node_modules/@types`],
});
const checker = program.getTypeChecker();
const sf = program.getSourceFile(FILE) as ts.SourceFile;
const ctx = {
  checker,
  importerFile: FILE,
  importerDisplayFile: "packages/derive/test/fixtures/tools.ts",
  sourceRoot: `${REPO}/packages/derive`,
  lossy: false,
};

/** The n-th element of the fixture's `refs` array: the expression a tool list entry lowers to. */
function ref(index: number): ts.Node {
  const s = sf.statements.find(
    (x) => ts.isVariableStatement(x) && (x.declarationList.declarations[0]?.name as ts.Identifier).text === "refs",
  ) as ts.VariableStatement;
  const list = s.declarationList.declarations[0]?.initializer as ts.ArrayLiteralExpression;
  return list.elements[index] as ts.Node;
}
const expr = (index: number): string => deriveTool(ref(index), ctx).expr;
const fails = (index: number): DerivationError => {
  try {
    deriveTool(ref(index), ctx);
  } catch (e) {
    if (e instanceof DerivationError) return e;
    throw e;
  }
  throw new Error(`ref ${index} derived`);
};

// The tool contract (spec 2026-10-08 §3.4): one object carrier over the
// parameters, keyed by name in declaration order, optional and defaulted
// parameters optional, JSDoc as descriptions; refusals name the reason.
describe("deriveTool", () => {
  it("parameters become an object carrier; the function's JSDoc is its description", () => {
    expect(expr(0)).toBe(
      '__nola.types.object({ dir: __nola.types.string(), pattern: __nola.types.optional(__nola.types.string()), limit: __nola.types.optional(__nola.types.number()) }).describe("Search files under a directory.")',
    );
  });

  it("@param tags describe the properties; the summary stays the tool's", () => {
    expect(expr(1)).toBe('__nola.types.object({ path: __nola.types.string().describe("the absolute path") }).describe("Read a file.")');
  });

  it("a member chain derives the function it names", () => {
    expect(expr(2)).toBe(expr(0));
    expect(expr(3)).toBe(expr(1));
  });

  it("a rest parameter, a generic parameter and an unsupported parameter type are refused by reason", () => {
    expect(fails(4).message).toContain("rest parameter");
    expect(fails(4).message).toContain("more");
    expect(fails(5).message).toContain("generic parameter T");
    expect(fails(11).message).toContain("Map<string, number>");
    expect(fails(11).message).toContain("parameter 'm'");
  });

  it("an overloaded function derives its first signature", () => {
    expect(expr(6)).toBe("__nola.types.object({ a: __nola.types.string() })");
  });

  it("a value that is not callable is NOLA2018", () => {
    const e = fails(7);
    expect(e.code).toBe("NOLA2018");
    expect(e.message).toContain("notCallable");
    expect(e.message).toContain("not callable");
  });

  it("a `this` parameter is not an argument; an object parameter nests; no parameters is an empty object", () => {
    expect(expr(8)).toBe("__nola.types.object({ a: __nola.types.string() })");
    expect(expr(9)).toBe(
      "__nola.types.object({ opts: __nola.types.object({ a: __nola.types.number(), b: __nola.types.optional(__nola.types.string()) }) })",
    );
    expect(expr(10)).toBe("__nola.types.object({})");
  });

  // §1.3 of spec 2026-10-09: one declared signature — a union of functions,
  // `any` and `unknown` are refused with the shown type, never derived by luck.
  it("a union of function types is NOLA2018 naming the alias and its type", () => {
    const e = fails(12);
    expect(e.code).toBe("NOLA2018");
    expect(e.message).toMatch(/'unionFn' is a union of function types/);
  });

  it("`any` and `unknown` are NOLA2018: the checker cannot see a function", () => {
    expect(fails(13).message).toMatch(/'anyFn' is any — the checker cannot see a function/);
    expect(fails(14).message).toMatch(/'unknownFn' is unknown/);
  });

  it("the outcome names a written single entry for the collision pass", () => {
    expect(deriveTool(ref(0), ctx, { ask: "1:1", written: "search" }).names).toEqual(["search"]);
    expect(deriveTool(ref(0), ctx, { ask: "1:1" }).names).toEqual([]);
  });
});

describe("deriveTool — groups (spec 2026-10-09 §3.4)", () => {
  const bare = (i: number, written: string) => deriveTool(ref(i), ctx, { ask: "1:1", written });
  const spread = (i: number) => deriveTool(ref(i), ctx, { ask: "1:1", spread: true });
  const failsWith = (i: number, flags: Parameters<typeof deriveTool>[2]): DerivationError => {
    try {
      deriveTool(ref(i), ctx, flags);
    } catch (e) {
      if (e instanceof DerivationError) return e;
      throw e;
    }
    throw new Error(`ref ${i} derived`);
  };

  it("a module namespace offers its callable exports by key in declaration order; constants, classes and `default` are skipped", () => {
    const out = spread(15);
    expect(out.expr).toBe(
      '__nola.tools.members({ search: __nola.types.object({ q: __nola.types.string() }).describe("Search the index."), readFile: __nola.types.object({ path: __nola.types.string() }), find: __nola.types.object({ q: __nola.types.string() }).describe("Search the index.") })',
    );
    expect(out.names).toEqual(["search", "readFile", "find"]);
    expect(bare(15, "ns").names).toEqual(["ns.search", "ns.readFile", "ns.find"]);
  });

  it("an object of functions is a members verdict; a nested object is skipped, never a sub-group", () => {
    const out = bare(18, "group");
    expect(out.expr).toBe(
      '__nola.tools.members({ search: __nola.types.object({ dir: __nola.types.string(), pattern: __nola.types.optional(__nola.types.string()), limit: __nola.types.optional(__nola.types.number()) }).describe("Search files under a directory."), readFile: __nola.types.object({ path: __nola.types.string().describe("the absolute path") }).describe("Read a file.") })',
    );
    expect(out.names).toEqual(["group.search", "group.readFile"]);
  });

  it("a tuple is a tuple verdict with element names from declarations; an array is an array verdict with no names", () => {
    const t = bare(16, "tuple");
    // each element through the function walk — the contracts of `search` and `readFile` themselves, JSDoc included
    expect(t.expr).toBe(`__nola.tools.tuple([${expr(0)}, ${expr(1)}])`);
    expect(t.names).toEqual(["tuple.search", "tuple.readFile"]);
    const a = spread(17);
    expect(a.expr).toBe("__nola.tools.array(__nola.types.object({ path: __nola.types.string() }))");
    expect(a.names).toEqual([]);
  });

  it("a function under a spread, a group without a written name, and a group with nothing callable are NOLA2018", () => {
    expect(failsWith(0, { ask: "1:1", spread: true }).message).toMatch(/'search' is one function — spread a group/);
    expect(failsWith(18, { ask: "1:1" }).message).toMatch(/'group' is a group reached through an expression — name it or spread it/);
    expect(failsWith(19, { ask: "1:1", written: "noFunctions" }).message).toMatch(/'noFunctions' has no function-valued member/);
  });

  it("a member the walk cannot use fails the group naming the member", () => {
    const e = failsWith(20, { ask: "1:1", written: "badMember" });
    expect(e.message).toMatch(/rest parameter 'more' of member 'withRest' of badMember/);
  });

  it("a spread of `any`, `unknown` or a union of functions names the shown type, not the spread rule", () => {
    expect(failsWith(13, { ask: "1:1", spread: true }).message).toMatch(/'anyFn' is any — the checker cannot see a function/);
    expect(failsWith(14, { ask: "1:1", spread: true }).message).toMatch(/'unknownFn' is unknown/);
    expect(failsWith(12, { ask: "1:1", spread: true }).message).toMatch(/'unionFn' is a union of function types/);
  });
});

function project(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "nola-derive-tool-"));
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), text);
  }
  return root;
}

const TSCONFIG =
  '{ "compilerOptions": { "strict": true, "module": "NodeNext", "moduleResolution": "NodeNext", "target": "ES2022", "allowArbitraryExtensions": true, "skipLibCheck": true }, "include": ["src"] }';

describe("tool requests through the DerivationService", () => {
  it("answers a lowered .tsi's tool requests against the imported plain-TS functions", () => {
    const main = 'import { search } from "./tools.js";\nconst files = ask `find the visa files` [search]: string[];\n';
    const root = project({
      "tsconfig.json": TSCONFIG,
      "src/tools.ts": '/** Search files under a directory. */\nexport function search(dir: string, pattern?: string): Promise<string[]> { return Promise.resolve([dir, pattern ?? ""]); }\n',
      "src/main.tsi": main,
    });
    const svc = createDerivationService({ projectRoot: root, sourceRoot: root, underivableContextType: "error" });
    const file = join(root, "src/main.tsi");
    const p1 = compileNola(main, file, { sourceRoot: root });
    const { answers } = svc.derive(file, p1);
    const done = finalizeDerivations(p1, answers, file);
    svc.dispose();
    expect(done.diagnostics).toEqual([]);
    expect(done.code).toContain(
      'function __nola_type_$1(): import("@nola-lang/runtime").InferType<unknown> { return __nola.types.array(__nola.types.string()); }',
    );
    expect(done.code).toContain(
      'function __nola_tool_$2(): import("@nola-lang/runtime").ToolVerdict { return __nola.types.object({ dir: __nola.types.string(), pattern: __nola.types.optional(__nola.types.string()) }).describe("Search files under a directory."); }',
    );
  });

  it("a non-callable entry is NOLA2018 at the entry", () => {
    const main = "const n = 1;\nconst x = ask `p` [n]: string;\n";
    const root = project({ "tsconfig.json": TSCONFIG, "src/main.tsi": main });
    const svc = createDerivationService({ projectRoot: root, sourceRoot: root, underivableContextType: "error" });
    const file = join(root, "src/main.tsi");
    const p1 = compileNola(main, file, { sourceRoot: root });
    const { answers } = svc.derive(file, p1);
    const done = finalizeDerivations(p1, answers, file);
    svc.dispose();
    expect(done.diagnostics.map((d) => [d.code, d.loc.start.line, d.loc.start.column])).toEqual([["NOLA2018", 2, 19]]);
  });

  it("a bare group and a spread entry finalize to verdict accessors (spec 2026-10-09)", () => {
    const main = 'import * as fileTools from "./tools.js";\nconst a = ask `p` [fileTools]: string[];\nconst b = ask `q` [...fileTools]: string[];\n';
    const root = project({
      "tsconfig.json": TSCONFIG,
      "src/tools.ts": "/** Search. */\nexport function search(q: string): string[] { return [q]; }\nexport const limit = 1;\n",
      "src/main.tsi": main,
    });
    const svc = createDerivationService({ projectRoot: root, sourceRoot: root, underivableContextType: "error" });
    const file = join(root, "src/main.tsi");
    const p1 = compileNola(main, file, { sourceRoot: root });
    const { answers } = svc.derive(file, p1);
    const done = finalizeDerivations(p1, answers, file);
    svc.dispose();
    expect(done.diagnostics).toEqual([]);
    // the site counter: $1 the first type, $2 the group, $3 the second type, $4 the spread
    expect(done.code).toContain(
      'function __nola_tool_$2(): import("@nola-lang/runtime").ToolVerdict { return __nola.tools.members({ search: __nola.types.object({ q: __nola.types.string() }).describe("Search.") }); }',
    );
    expect(done.code).toContain(
      'function __nola_tool_$4(): import("@nola-lang/runtime").ToolVerdict { return __nola.tools.members({ search: __nola.types.object({ q: __nola.types.string() }).describe("Search.") }); }',
    );
  });
});
