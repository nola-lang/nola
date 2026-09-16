import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { deriveType, type WalkOutcome } from "../src/walk.js";

const REPO = fileURLToPath(new URL("../../..", import.meta.url)).replace(/\\/g, "/").replace(/\/$/, "");
const FILE = `${REPO}/packages/derive/test/fixtures/shapes.ts`;
const program = ts.createProgram([FILE], {
  strict: true,
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.NodeNext,
  moduleResolution: ts.ModuleResolutionKind.NodeNext,
  skipLibCheck: true,
  noEmit: true,
  types: ["node"],
  typeRoots: [`${REPO}/node_modules/@types`],
  baseUrl: REPO,
  paths: { "@nola-lang/core": ["packages/core/src/index.ts"] },
});
const checker = program.getTypeChecker();
const sf = program.getSourceFile(FILE) as ts.SourceFile;
const ctx = {
  checker,
  importerFile: FILE,
  importerDisplayFile: "packages/derive/test/fixtures/shapes.ts",
  // the fixture's project is the package dir: core (mapped via paths) is OUTSIDE it, i.e. a package type
  sourceRoot: `${REPO}/packages/derive`,
  lossy: false,
};

function decl(name: string): ts.Node {
  const s = sf.statements.find(
    (x) =>
      (ts.isTypeAliasDeclaration(x) || ts.isInterfaceDeclaration(x) || ts.isEnumDeclaration(x)) && x.name.text === name,
  );
  if (!s) throw new Error(name);
  return (s as ts.TypeAliasDeclaration).name;
}
const expr = (name: string): string => deriveType(decl(name), ctx, name).expr;
const out = (name: string): WalkOutcome => deriveType(decl(name), ctx, name);

describe("checker walk", () => {
  it("old shapes are byte-identical to the syntactic walker", () => {
    expect(expr("Address")).toBe(
      '__nola.types.object({ city: __nola.types.string(), zip: __nola.types.string().describe("postal code as written") })',
    );
    expect(expr("Person")).toBe(
      '__nola.types.object({ name: __nola.types.string(), age: __nola.types.optional(__nola.types.number()), home: __nola.types.ref("Address", __nola_type_Address) })',
    );
    expect(expr("Sentiment")).toBe('__nola.types.enum(["positive","negative"])');
    expect(expr("CalendarEvent")).toBe("__nola.types.object({ title: __nola.types.string(), at: __nola.types.date() })");
    expect(expr("Tree")).toBe(
      '__nola.types.object({ label: __nola.types.string(), children: __nola.types.optional(__nola.types.array(__nola.types.ref("Tree", __nola_type_Tree))) })',
    );
  });

  it("utility types, extends and intersections flatten", () => {
    expect(expr("PartialPerson")).toBe(
      '__nola.types.object({ name: __nola.types.optional(__nola.types.string()), age: __nola.types.optional(__nola.types.number()), home: __nola.types.optional(__nola.types.ref("Address", __nola_type_Address)) })',
    );
    expect(expr("NameOnly")).toBe("__nola.types.object({ name: __nola.types.string() })");
    expect(expr("AllRequired")).toContain("age: __nola.types.number()");
    expect(expr("Employee")).toBe(
      '__nola.types.object({ role: __nola.types.enum(["admin","member"]), name: __nola.types.string(), age: __nola.types.optional(__nola.types.number()), home: __nola.types.ref("Address", __nola_type_Address) })',
    );
    expect(expr("Tagged")).toContain("tag: __nola.types.string()");
    expect(expr("NumBox")).toBe(
      "__nola.types.object({ value: __nola.types.number(), items: __nola.types.array(__nola.types.number()) })",
    );
  });

  it("unions, literals, nullable", () => {
    expect(expr("Event")).toBe(
      '__nola.types.union([__nola.types.object({ kind: __nola.types.enum(["refund"]), amount: __nola.types.number() }), __nola.types.object({ kind: __nola.types.enum(["chargeback"]), reason: __nola.types.string() })])',
    );
    expect(expr("Maybe")).toBe(
      '__nola.types.object({ note: __nola.types.nullable(__nola.types.string()), tag: __nola.types.optional(__nola.types.enum(["a","b"])), flag: __nola.types.boolean(), count: __nola.types.union([__nola.types.literal(1), __nola.types.literal(2), __nola.types.literal(3)]) })',
    );
    expect(expr("Mixed")).toBe("__nola.types.union([__nola.types.string(), __nola.types.number()])");
    expect(expr("Level")).toBe("__nola.types.union([__nola.types.literal(0), __nola.types.literal(1)])");
  });

  it("tuples, records, index signatures", () => {
    expect(expr("Pair")).toBe("__nola.types.tuple([__nola.types.string(), __nola.types.number()])");
    expect(expr("Counts")).toBe("__nola.types.record(__nola.types.number())");
    expect(expr("Dict")).toBe('__nola.types.record(__nola.types.ref("Address", __nola_type_Address))');
  });

  it("package and lib types derive structurally into hashed local accessors", () => {
    const o = out("PathParts");
    expect(o.expr).toMatch(/^__nola\.types\.ref\("@types\/node\/path#ParsedPath", __nola_type_x_[0-9a-f]{8}\)$/);
    expect(o.accessors[0]?.name).toMatch(/^x_[0-9a-f]{8}$/);
    const body = o.accessors[0] && "expr" in o.accessors[0] ? o.accessors[0].expr : "";
    expect(body).toContain("root: __nola.types.string().describe(");
    expect(o.imports).toEqual([]);
    expect(o.deps.some((d) => /@types\/node\/path\.d\.ts$/.test(d))).toBe(true);
    expect(out("Issue").expr).toMatch(
      /^__nola\.types\.ref\(".*packages\/core\/src\/validation#ValidationIssue", __nola_type_x_[0-9a-f]{8}\)$/,
    );
  });

  it("transitive named accessors ride the outcome once each", () => {
    expect(out("Person").accessors.map((a) => a.name)).toEqual(["Address"]);
  });

  it("unsupported: bare generic, Map, function, Promise — with reasons", () => {
    expect(() => expr("Box")).toThrow(/Box<T> is a generic declaration; instantiate it/);
    expect(() => expr("Exotic")).toThrow(/unsupported type Map<string, number> at property 'lookup' of Exotic/);
  });

  it("prune drops underivable members; an object that prunes to nothing fails", () => {
    expect(() => deriveType(decl("Exotic"), { ...ctx, lossy: true }, "Exotic")).toThrow(/type Exotic has no derivable members/);
  });
});
