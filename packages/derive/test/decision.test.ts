import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { deriveType, type WalkOutcome } from "../src/walk.js";

const REPO = fileURLToPath(new URL("../../..", import.meta.url)).replace(/\\/g, "/").replace(/\/$/, "");
const FILE = `${REPO}/packages/derive/test/fixtures/decision.ts`;
// the fixture's `@nola-lang/runtime` import resolves to the type module itself — no build needed
const program = ts.createProgram([FILE], {
  strict: true,
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.NodeNext,
  moduleResolution: ts.ModuleResolutionKind.NodeNext,
  skipLibCheck: true,
  noEmit: true,
  baseUrl: REPO,
  paths: { "@nola-lang/runtime": [`${REPO}/packages/runtime/src/types/decision.ts`] },
});
const checker = program.getTypeChecker();
const sf = program.getSourceFile(FILE) as ts.SourceFile;
const ctx = {
  checker,
  importerFile: FILE,
  importerDisplayFile: "packages/derive/test/fixtures/decision.ts",
  sourceRoot: `${REPO}/packages/derive`,
  lossy: false,
};

function decl(name: string): ts.Node {
  const s = sf.statements.find(
    (x) => (ts.isTypeAliasDeclaration(x) || ts.isInterfaceDeclaration(x)) && x.name.text === name,
  );
  if (!s) throw new Error(name);
  return (s as ts.TypeAliasDeclaration).name;
}
const out = (name: string, lossy = false): WalkOutcome => deriveType(decl(name), { ...ctx, lossy }, name);
const expr = (name: string): string => out(name).expr;

describe("decision types in the checker walk", () => {
  it("each type derives to its combinator", () => {
    expect(expr("Dept")).toBe('__nola.types.choice({"billing":"Payments and refunds","sales":null})');
    expect(expr("Bare")).toBe('__nola.types.choice({"a":null,"b":null})');
    expect(expr("Mood")).toBe('__nola.types.scale(["Calm","Frustrated but civil","Angry"])');
    expect(expr("Urgent")).toBe('__nola.types.prob({"true":"Explicit time pressure","false":"No urgency"})');
    expect(expr("Plain")).toBe("__nola.types.prob()");
  });

  it("numeric labels derive with the list of number labels, keyed by the number's text", () => {
    expect(expr("Numeric")).toBe('__nola.types.choice({"1":null,"2":null,"3":null}, { numeric: ["1","2","3"] })');
    expect(expr("NumericDescribed")).toBe('__nola.types.choice({"1":"Low","2":"High"}, { numeric: ["1","2"] })');
    expect(expr("MixedLabels")).toBe('__nola.types.choice({"42":null,"other":null}, { numeric: ["42"] })');
  });

  it("inside an interface: JSDoc becomes describe, optional wraps, plain forms untouched", () => {
    expect(expr("Triage")).toBe(
      [
        "__nola.types.object({ ",
        'department: __nola.types.ref("Dept", __nola_type_Dept).describe("Which team should handle this?"), ',
        'frustration: __nola.types.ref("Mood", __nola_type_Mood).describe("How frustrated is the customer?"), ',
        'urgent: __nola.types.ref("Urgent", __nola_type_Urgent), ',
        'plain: __nola.types.optional(__nola.types.ref("Plain", __nola_type_Plain)), ',
        'team: __nola.types.enum(["billing","sales"])',
        " })",
      ].join(""),
    );
  });

  it("the criteria survive Pick, Partial and a generic wrapper", () => {
    // through a mapped type the member may come back inline or as a ref to the alias — both carry the criteria
    const choice = '__nola\\.types\\.choice\\(\\{"billing":"Payments and refunds","sales":null\\}\\)';
    const scale = '__nola\\.types\\.scale\\(\\["Calm","Frustrated but civil","Angry"\\]\\)';
    expect(expr("Picked")).toMatch(new RegExp(`department: (${choice}|__nola\\.types\\.ref\\("Dept", __nola_type_Dept\\))`));
    expect(expr("Loose")).toMatch(
      new RegExp(`frustration: __nola\\.types\\.optional\\((${scale}|__nola\\.types\\.ref\\("Mood", __nola_type_Mood\\))\\)`),
    );
    // a generic instantiated with an alias keeps the alias name on the resolved type (TS records
    // the outer alias), so the member is a ref to it; an inline argument would derive inline
    expect(expr("Wrapped")).toMatch(new RegExp(`inner: (${scale}|__nola\\.types\\.ref\\("Mood", __nola_type_Mood\\))`));
    // whichever form, the alias accessors carry the combinator
    const picked = out("Picked");
    for (const acc of picked.accessors) if (acc.name === "Dept") expect(acc.expr).toMatch(new RegExp(choice));
  });

  it.each([
    ["OneLabel", "OneLabel: Choice needs 2 to 255 labels, got 1"],
    ["SameText", 'SameText: Choice labels 1 and "1" share the text "1"'],
    ["NonLiteral", 'NonLiteral: Choice description for "a" must be a string literal or null'],
    ["LongScale", "LongScale: Scale needs 2 to 10 levels, got 11"],
    ["HalfProb", 'HalfProb: Prob criteria must be exactly { true: "…"; false: "…" }, got maybe'],
  ])("%s is NOLA2015 with a precise message", (name, message) => {
    expect(() => out(name)).toThrow(message);
    try {
      out(name);
    } catch (e) {
      expect((e as { code?: string }).code).toBe("NOLA2015");
    }
  });

  it("NOLA2015 is thrown under prune too (an authoring error, never dropped as underivable)", () => {
    expect(() => out("PrunedBad", true)).toThrow(/Prob criteria must be exactly/);
  });

  it("a constraint tag on a Prob is NOLA2012 (the tags do not apply to a probability)", () => {
    expect(() => out("ProbWithTags")).toThrow(/@minimum applies to numbers, not to/);
  });

  it("ShortScale with exactly two levels is legal", () => {
    expect(expr("ShortScale")).toBe('__nola.types.scale(["x","y"])');
  });
});
