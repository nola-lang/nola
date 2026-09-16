import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { deriveType, type WalkOutcome } from "../src/walk.js";

const REPO = fileURLToPath(new URL("../../..", import.meta.url)).replace(/\\/g, "/").replace(/\/$/, "");
const FILE = `${REPO}/packages/derive/test/fixtures/constraints.ts`;
const program = ts.createProgram([FILE], {
  strict: true,
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.NodeNext,
  moduleResolution: ts.ModuleResolutionKind.NodeNext,
  skipLibCheck: true,
  noEmit: true,
});
const checker = program.getTypeChecker();
const sf = program.getSourceFile(FILE) as ts.SourceFile;
const ctxFor = (lossy: boolean) => ({
  checker,
  importerFile: FILE,
  importerDisplayFile: "packages/derive/test/fixtures/constraints.ts",
  sourceRoot: `${REPO}/packages/derive`,
  lossy,
});

function decl(name: string): ts.Node {
  const s = sf.statements.find(
    (x) => (ts.isTypeAliasDeclaration(x) || ts.isInterfaceDeclaration(x)) && x.name.text === name,
  );
  if (!s) throw new Error(name);
  return (s as ts.TypeAliasDeclaration).name;
}
const out = (name: string, lossy = false): WalkOutcome => deriveType(decl(name), ctxFor(lossy), name);
const expr = (name: string): string => out(name).expr;

describe("JSDoc constraint tags", () => {
  it("every keyword on its kind, through nullable / optional / enum / tuple; unrelated tags ignored", () => {
    expect(expr("Signup")).toBe(
      [
        "__nola.types.object({ ",
        'email: __nola.types.string().constrain({"format":"email"}), ',
        'handle: __nola.types.string().constrain({"minLength":3,"maxLength":32,"pattern":"^[a-z0-9_]+$"}).describe("the public handle"), ',
        'age: __nola.types.number().constrain({"integer":true,"minimum":13,"maximum":120}), ',
        'tags: __nola.types.array(__nola.types.string()).constrain({"minItems":1,"maxItems":10,"uniqueItems":true}), ',
        'price: __nola.types.number().constrain({"multipleOf":0.01,"exclusiveMinimum":0}), ',
        'note: __nola.types.nullable(__nola.types.string()).constrain({"minLength":1}), ',
        'nick: __nola.types.optional(__nola.types.string().constrain({"minLength":1})), ',
        'role: __nola.types.enum(["admin","member"]).constrain({"minLength":2}), ',
        'pair: __nola.types.tuple([__nola.types.string(), __nola.types.number()]).constrain({"minItems":2}), ',
        "plain: __nola.types.string()",
        " })",
      ].join(""),
    );
  });

  it("alias tags live in the alias body; a property tag on an aliased type wraps the ref", () => {
    expect(expr("Id")).toBe('__nola.types.string().constrain({"format":"uuid"})');
    expect(expr("Tags")).toBe('__nola.types.array(__nola.types.string()).constrain({"minItems":1})');
    const order = out("Order");
    expect(order.expr).toBe(
      '__nola.types.object({ id: __nola.types.ref("Id", __nola_type_Id).constrain({"minLength":36}), ref: __nola.types.ref("Id", __nola_type_Id) })',
    );
    expect(order.accessors).toEqual([{ name: "Id", expr: '__nola.types.string().constrain({"format":"uuid"})' }]);
  });

  it.each([
    ["BadKind", "property 'n' of BadKind: @minLength applies to strings, not to number"],
    ["BadValue", "property 'n' of BadValue: @minimum needs a number, got 'ten'"],
    ["BadMissing", "property 'n' of BadMissing: @minimum needs a number"],
    ["BadFormat", "property 'e' of BadFormat: unknown @format 'e-mail' (expected date-time, date, time, email, uri, uuid, ipv4, ipv6, hostname)"],
    ["BadPattern", "property 's' of BadPattern: @pattern is not a valid regular expression"],
    ["Twice", "property 'n' of Twice: @minimum is given twice"],
    ["OnObject", "property 'o' of OnObject: @minItems applies to arrays, not to { a: string; }"],
    ["Mixed", "property 'm' of Mixed: @minLength applies to strings, not to string | number"],
    ["OnDate", "property 'd' of OnDate: @format applies to strings, not to Date"],
    ["FlagWithValue", "property 'n' of FlagWithValue: @integer takes no value, got 'yes'"],
    ["BadAlias", "type BadAlias: @minimum applies to numbers, not to { a: string; }"],
  ])("%s is NOLA2012", (name, message) => {
    let err: unknown;
    try {
      out(name);
    } catch (e) {
      err = e;
    }
    expect((err as { code?: string }).code).toBe("NOLA2012");
    expect((err as Error).message).toContain(message);
  });

  it("prune (lossy) does not swallow a bad tag", () => {
    expect(() => out("BadKind", true)).toThrow(/NOLA2012|applies to strings/);
  });
});
