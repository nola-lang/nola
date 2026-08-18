// biome-ignore-all lint/suspicious/noTemplateCurlyInString: .tsi fixtures contain literal ${} interpolation
import { compileCompanion, compileNola } from "@nola-lang/compiler";
import { describe, expect, it } from "vitest";
import { typecheckLowered } from "./helpers/typecheck.js";

const FIXTURES: Record<string, string> = {
  "spec-example.ts": [
    "export infer function analyzeUserRequest(userId: string) {",
    "  const ticketId = ask ..`ticket id in GUID format`<string>;",
    "  const isFraud = ask ..`does it have fraud`<boolean>;",
    "  return { ticketId, isFraud };",
    "}",
    "",
  ].join("\n"),
  "typed-shapes.ts": [
    "type User = { id: string; name?: string };",
    "export infer function load(q: string) {",
    "  const user = ask ..`user`<User>;",
    "  const tags = ask ..`tags`<string[]>;",
    "  const point = ask ..`pt`<{ x: number; y?: number }>;",
    "  return { user, tags, point };",
    "}",
    "",
  ].join("\n"),
  "module-level-intent.ts": ["export const nameIntent = ..`user name`<string>;", ""].join("\n"),
  "marker-template.ts": [
    "export infer function go`${.default}",
    "Args: ${.args.map(a => `${a.name}=${JSON.stringify(a.value)} (${a.type ?? \"?\"}) ${a.contextual}`)}",
    "${.fn} ${.signature} ${.file ?? \"\"} ${.nested} ${.hasContext}",
    "${.next}`(.m: string, n: number) {",
    "  const v = ask ..`v`<string>;",
    "  return v;",
    "}",
    "",
  ].join("\n"),
  "extract-template.ts": [
    "export infer function go(a: string) {",
    "  const v = ask ..`${.default}\\nType is ${.type}; schema ${.schema}; ctx ${.hasContext}; ${a}`<string>;",
    "  return v;",
    "}",
    "",
  ].join("\n"),
  "recursive-type.ts": [
    "type TreeNode = { label: string; children?: TreeNode[] };",
    "export infer function parse(input: string) {",
    "  const tree = ask ..`tree in ${input}`<TreeNode>;",
    "  return tree;",
    "}",
    "",
  ].join("\n"),
  "classification.ts": [
    'type Category = "billing" | "refund" | "fraud";',
    "enum Sentiment {",
    '  Positive = "positive",',
    '  Negative = "negative",',
    "}",
    "export infer function classify(q: string) {",
    "  const category = ask ..`category`<Category>;",
    "  const sentiment = ask ..`sentiment`<Sentiment>;",
    '  const urgent = ask ..`urgent`<"yes" | "no">;',
    "  return { category, sentiment, urgent };",
    "}",
    "",
  ].join("\n"),
  "interpolation-await.ts": [
    "export infer function go(msg: string, p: Promise<number>) {",
    "  const n = await p;",
    "  const v = ask ..`v ${msg} ${n}`<string>;",
    "  return v;",
    "}",
    "",
  ].join("\n"),
  "declared-return.ts": [
    'import type { Intent } from "@nola-lang/runtime";',
    "interface User { name: string; }",
    "export infer function getUser(m: string): Intent<User> {",
    "  const u = ask ..`user from ${m}`<User>;",
    "  return u;",
    "}",
    "",
  ].join("\n"),
  "call-intent.ts": [
    "declare function fetchUser(name: string, n: number): Promise<string>;",
    "infer function proc() {",
    "  const s = ask fetchUser``(..`user name`<string>, 42);",
    "  return s;",
    "}",
    "",
  ].join("\n"),
  "sigil-less-call-intent.ts": [
    "declare function fetchUser(name: string, n: number): Promise<string>;",
    "infer function proc() {",
    "  const s = ask fetchUser(..`user name`<string>, 42);",
    "  return s;",
    "}",
    "",
  ].join("\n"),
  "contextual-params.ts": [
    "type Issue = { id: string; description: string };",
    "export infer function analyze(.issue: Issue, limit: number, cb: () => void) {",
    "  const kind = ask ..`the kind of this issue`<string>;",
    "  return kind;",
    "}",
    "",
  ].join("\n"),
  "date-field.ts": [
    "type Event = { title: string; at: Date };",
    "export infer function nextEvent(.hint: string) {",
    "  const e = ask ..`the next event`<Event>;",
    "  const at: Date = e.at;",
    "  return { e, at };",
    "}",
    "",
  ].join("\n"),
};

describe("lowered output is tsc-clean under strict", () => {
  it.each(Object.entries(FIXTURES))("%s lowers to type-clean TS", (name, source) => {
    const { code, diagnostics } = compileNola(source, name.replace(/\.ts$/, ".tsi"));
    expect(diagnostics).toEqual([]);
    const errors = typecheckLowered({ [name]: code });
    expect(errors).toEqual([]);
  });

  it("inferred types flow: ask<string> result is a string", () => {
    const source = [
      "export infer function f() {",
      "  const id = ask ..`id`<string>;",
      "  const upper: string = id;",
      "  return upper;",
      "}",
      "",
    ].join("\n");
    const { code } = compileNola(source, "flow.tsi");
    expect(typecheckLowered({ "flow.ts": code })).toEqual([]);
  });

  it("pruned contextual-param output is type-clean too", () => {
    const source = [
      "type User = { name: string; greet: () => string };",
      "export infer function analyze(.user: User) {",
      "  const kind = ask ..`kind of user`<string>;",
      "  return kind;",
      "}",
      "",
    ].join("\n");
    const { code, diagnostics } = compileNola(source, "pruned.tsi", { underivableContextType: "prune" });
    expect(diagnostics).toEqual([]);
    expect(code).toContain("__nola_type_User");
    expect(typecheckLowered({ "pruned.ts": code })).toEqual([]);
  });

  it("an unknown scope member in a template is a TS2339 at the member", () => {
    const source = ["export infer function f() {", "  const n = ask ..`x ${.nope}`<number>;", "  return n;", "}", ""].join(
      "\n",
    );
    const { code, diagnostics } = compileNola(source, "badtpl.tsi");
    expect(diagnostics).toEqual([]);
    const errors = typecheckLowered({ "badtpl.ts": code });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("TS2339");
    expect(errors[0]).toContain("nope");
  });

  it("misuse IS caught: assigning ask<number> to string errors", () => {
    const source = [
      "export infer function f() {",
      "  const n = ask ..`n`<number>;",
      "  const s: string = n;",
      "  return s;",
      "}",
      "",
    ].join("\n");
    const { code } = compileNola(source, "bad.tsi");
    const errors = typecheckLowered({ "bad.ts": code });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toContain("TS2322");
  });
});

describe("cross-file lowering is tsc-clean", () => {
  it("a .tsi importing a companion-served type type-checks", () => {
    const models = "export interface Person { name: string; manager?: Person }\n";
    const report = [
      'import type { Person } from "./models.js";',
      "export infer function extract(text: string) {",
      "  const p = ask ..`person in ${text}`<Person>;",
      "  return p;",
      "}",
      "",
    ].join("\n");
    const lowered = compileNola(report, "/proj/report.tsi", { sourceRoot: "/proj" });
    const companion = compileCompanion(models, "/proj/models.ts", { sourceRoot: "/proj" });
    expect(lowered.diagnostics).toEqual([]);
    expect(companion.diagnostics).toEqual([]);
    const errors = typecheckLowered({
      "report.ts": lowered.code,
      "models.ts": models,
      "models.nola.ts": companion.code,
    });
    expect(errors).toEqual([]);
  });

  it("using an UnsupportedType at an ask site is a TS error carrying the reason", () => {
    const models = "export type Weird = Map<string, number>;\n";
    const use = ['import type { Weird } from "./models.js";', "export const i = ..`x`<Weird>;", ""].join("\n");
    const lowered = compileNola(use, "/proj/use.tsi", { sourceRoot: "/proj" });
    const companion = compileCompanion(models, "/proj/models.ts", { sourceRoot: "/proj" });
    expect(lowered.diagnostics).toEqual([]);
    const errors = typecheckLowered({
      "use.ts": lowered.code,
      "models.ts": models,
      "models.nola.ts": companion.code,
    });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.join("\n")).toContain("unsupported type for intent schema");
  });
});
