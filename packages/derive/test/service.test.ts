import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { compileNola, finalizeDerivations } from "@nola-lang/compiler";
import { describe, expect, it } from "vitest";
import { createDerivationService } from "../src/service.js";

function project(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "nola-derive-"));
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), text);
  }
  return root;
}

const TSCONFIG =
  '{ "compilerOptions": { "strict": true, "module": "NodeNext", "moduleResolution": "NodeNext", "target": "ES2022", "allowArbitraryExtensions": true, "skipLibCheck": true }, "include": ["src"] }';

function lowerAndDerive(root: string, rel: string, source: string, policy: "error" | "prune" | "omit" = "error") {
  const svc = createDerivationService({ projectRoot: root, sourceRoot: root, underivableContextType: policy });
  const file = join(root, rel);
  const p1 = compileNola(source, file, { sourceRoot: root, underivableContextType: policy });
  const { answers } = svc.derive(file, p1);
  const done = finalizeDerivations(p1, answers, file);
  svc.dispose();
  return { done, answers, src: source };
}

describe("DerivationService", () => {
  it("answers a lowered .tsi's requests, reaching a plain-TS import through a view import", () => {
    const report =
      'import type { Person } from "./models.js";\nexport type Partial2 = Partial<Person>;\nconst i = ..`who`<Person>;\n';
    const root = project({
      "tsconfig.json": TSCONFIG,
      "src/models.ts": "export interface Person { name: string; age?: number }\n",
      "src/report.tsi": report,
    });
    const { done, answers } = lowerAndDerive(root, "src/report.tsi", report);
    expect(done.diagnostics).toEqual([]);
    expect(done.code).toContain(
      'function __nola_type_$1(): import("@nola-lang/runtime").InferType<unknown> { return __nola.types.ref("src/models#Person", () => __nola_type_Person); }',
    );
    expect(done.code).toContain('import { Person as __nola_type_Person } from "./models.tsi";');
    expect(done.code).toContain(
      'function __nola_type_Partial2(): import("@nola-lang/runtime").InferType<unknown> { return __nola.types.object({ name: __nola.types.optional(__nola.types.string()), age: __nola.types.optional(__nola.types.number()) }); }',
    );
    expect(done.meta.views).toEqual(["./models.tsi"]);
    expect(answers.some((a) => a.deps.some((d) => d.endsWith("models.ts")))).toBe(true);
  });

  it("same-file named types: bare refs + one hoisted accessor each; a real .tsi import keeps its specifier", () => {
    const shapes = "export type Shape = { kind: string };\n";
    const x = [
      'import type { Shape } from "./shapes.tsi";',
      "type Address = { city: string };",
      "type User = { name: string; home: Address; shape: Shape };",
      "const a = ..`a`<User>;",
      "const b = ..`b`<User>;",
      "",
    ].join("\n");
    const root = project({ "src/shapes.tsi": shapes, "src/x.tsi": x });
    const { done } = lowerAndDerive(root, "src/x.tsi", x);
    expect(done.diagnostics).toEqual([]);
    expect(done.code.match(/function __nola_type_User\(\)/g)).toHaveLength(1);
    expect(done.code.match(/function __nola_type_Address\(\)/g)).toHaveLength(1);
    expect(done.code).toContain('__nola.types.ref("User", __nola_type_User)');
    expect(done.code).toContain('home: __nola.types.ref("Address", __nola_type_Address)');
    expect(done.code).toContain('shape: __nola.types.ref("src/shapes#Shape", () => __nola_type_Shape)');
    expect(done.code).toContain('import { Shape as __nola_type_Shape } from "./shapes.tsi";');
    expect(done.meta.views).toEqual(["./shapes.tsi"]);
  });

  it("Date derives; a local declaration shadows the built-in", () => {
    const root = project({
      "src/a.tsi": "const i = ..`when`<Date>;\n",
      "src/b.tsi": "type Date = { iso: string };\nconst i = ..`when`<Date>;\n",
    });
    const a = lowerAndDerive(root, "src/a.tsi", "const i = ..`when`<Date>;\n");
    expect(a.done.code).toContain("{ return __nola.types.date(); }");
    const b = lowerAndDerive(root, "src/b.tsi", "type Date = { iso: string };\nconst i = ..`when`<Date>;\n");
    expect(b.done.code).toContain('{ return __nola.types.ref("Date", __nola_type_Date); }');
    expect(b.done.code).toContain("{ return __nola.types.object({ iso: __nola.types.string() }); }");
  });

  it("unsupported <T> is NOLA2002 at the source type (every policy); a package type import now derives", () => {
    const src = "const i = ..`x`<Map<string, string>>;\n";
    const root = project({ "src/x.tsi": src });
    for (const policy of ["error", "prune", "omit"] as const) {
      const { done } = lowerAndDerive(root, "src/x.tsi", src, policy);
      expect(done.diagnostics.map((d) => [d.code, src.slice(d.start, d.end)])).toEqual([["NOLA2002", "Map<string, string>"]]);
      expect(done.diagnostics[0]?.message).toContain("Map<string, string>");
    }
  });

  it("contextual-param policy: error → NOLA2008 at the annotation; omit → undefined accessor; prune → member dropped", () => {
    const poisoned = "type User = { name: string; cb: () => void };\ninfer function analyze(.user: User) {\n  return 1;\n}\n";
    const root = project({ "src/p.tsi": poisoned });
    const err = lowerAndDerive(root, "src/p.tsi", poisoned, "error");
    expect(err.done.diagnostics.map((d) => [d.code, poisoned.slice(d.start, d.end)])).toEqual([["NOLA2008", "User"]]);
    expect(err.done.diagnostics[0]?.message).toContain("underivableContextType");
    expect(err.done.diagnostics[0]?.message).toContain("'cb'");

    const omit = lowerAndDerive(root, "src/p.tsi", poisoned, "omit");
    expect(omit.done.diagnostics).toEqual([]);
    expect(omit.done.code).toContain("| undefined { return undefined; }");
    expect(omit.done.code).not.toContain("__nola_type_User");

    const prune = lowerAndDerive(root, "src/p.tsi", poisoned, "prune");
    expect(prune.done.diagnostics).toEqual([]);
    expect(prune.done.code).toContain('{ return __nola.types.ref("User", __nola_type_User); }');
    expect(prune.done.code).toContain("{ return __nola.types.object({ name: __nola.types.string() }); }");
  });

  it("prune: a member referencing a fully-underivable named type is dropped; a type that prunes to nothing falls back to omit; recursion survives", () => {
    const root = project({ "src/p.tsi": "" });
    const handler = [
      "type Handler = { cb: () => void };",
      "type User = { name: string; handler: Handler };",
      "infer function analyze(.user: User) {\n  return 1;\n}",
      "",
    ].join("\n");
    const h = lowerAndDerive(root, "src/p.tsi", handler, "prune");
    expect(h.done.diagnostics).toEqual([]);
    expect(h.done.code).toContain("{ return __nola.types.object({ name: __nola.types.string() }); }");
    expect(h.done.code).not.toContain("__nola_type_Handler");

    const bare = "type Bare = { cb: () => void };\ninfer function analyze(.b: Bare) {\n  return 1;\n}\n";
    const b = lowerAndDerive(root, "src/p.tsi", bare, "prune");
    expect(b.done.diagnostics).toEqual([]);
    expect(b.done.code).toContain("| undefined { return undefined; }");

    const rec = "type Node = { next?: Node; cb: () => void };\ninfer function walk(.n: Node) {\n  return 1;\n}\n";
    const r = lowerAndDerive(root, "src/p.tsi", rec, "prune");
    expect(r.done.code).toContain(
      '{ return __nola.types.object({ next: __nola.types.optional(__nola.types.ref("Node", __nola_type_Node)) }); }',
    );
  });

  it("an exported type reaching an underivable named type becomes UnsupportedType with the inner reason", () => {
    const src = "type Bad = { cb: () => void };\nexport type Wrap = { inner: Bad };\n";
    const root = project({ "src/w.tsi": src });
    const { done } = lowerAndDerive(root, "src/w.tsi", src);
    expect(done.diagnostics).toEqual([]);
    expect(done.code).toMatch(/function __nola_type_Wrap\(\): import\("@nola-lang\/runtime"\)\.UnsupportedType<"unsupported method 'cb' of Bad">/);
    expect(done.code).not.toContain("__nola_type_Bad");
  });

  it("deriveView finalizes the view of a plain module; invalidate() re-derives after the source changed", () => {
    const root = project({ "src/models.ts": "export interface P { a: string }\n" });
    const svc = createDerivationService({ projectRoot: root, sourceRoot: root, underivableContextType: "error" });
    const v1 = svc.deriveView(join(root, "src/models.ts"));
    expect(v1.code).toContain("{ return __nola.types.object({ a: __nola.types.string() }); }");
    writeFileSync(join(root, "src/models.ts"), "export interface P { a: Map<string, number> }\n");
    svc.invalidate(join(root, "src/models.ts"));
    const v2 = svc.deriveView(join(root, "src/models.ts"));
    expect(v2.code).toContain("UnsupportedType<");
    svc.dispose();
  });

  it("works without a tsconfig (default strict NodeNext options)", () => {
    const src = "export type T = { a: string; b?: number[] };\n";
    const root = project({ "src/t.tsi": src });
    const { done } = lowerAndDerive(root, "src/t.tsi", src);
    expect(done.code).toContain(
      "{ return __nola.types.object({ a: __nola.types.string(), b: __nola.types.optional(__nola.types.array(__nola.types.number())) }); }",
    );
  });

  it("malformed decision criteria are NOLA2015 at the extract and context sites under every policy", () => {
    const repo = fileURLToPath(new URL("../../..", import.meta.url)).replace(/\\/g, "/").replace(/\/$/, "");
    // a temp project cannot resolve @nola-lang/runtime: map it to the type module itself
    const tsconfig = JSON.stringify({
      compilerOptions: {
        strict: true,
        module: "NodeNext",
        moduleResolution: "NodeNext",
        target: "ES2022",
        allowArbitraryExtensions: true,
        skipLibCheck: true,
        baseUrl: ".",
        paths: { "@nola-lang/runtime": [`${repo}/packages/runtime/src/types/decision.ts`] },
      },
      include: ["src"],
    });
    const src = "type Bad = Choice<{ only: null }>;\ninfer function f(.d: Bad) {\n  return ask ..`x`<Bad>;\n}\n";
    for (const policy of ["error", "prune", "omit"] as const) {
      const root = project({ "tsconfig.json": tsconfig, "src/main.tsi": src });
      const { done } = lowerAndDerive(root, "src/main.tsi", src, policy);
      expect(done.diagnostics.map((d) => [d.code, d.message])).toEqual([
        ["NOLA2015", "Bad: Choice needs 2 to 255 labels, got 1"],
        ["NOLA2015", "Bad: Choice needs 2 to 255 labels, got 1"],
      ]);
      expect(done.code).not.toContain("unsupported(");
    }
  });

  it("the ..choice / ..scale sugar derives the wrapped type at its padded lowered range", () => {
    const repo = fileURLToPath(new URL("../../..", import.meta.url)).replace(/\\/g, "/").replace(/\/$/, "");
    const tsconfig = JSON.stringify({
      compilerOptions: {
        strict: true,
        module: "NodeNext",
        moduleResolution: "NodeNext",
        target: "ES2022",
        allowArbitraryExtensions: true,
        skipLibCheck: true,
        baseUrl: ".",
        paths: { "@nola-lang/runtime": [`${repo}/packages/runtime/src/types/decision.ts`] },
      },
      include: ["src"],
    });
    const src = [
      'const d = ..choice`Which team?`<{ billing: "Payments"; sales: null }>;',
      'const s = ..scale`How bad?`<["low", "high"]>;',
      "",
    ].join("\n");
    const root = project({ "tsconfig.json": tsconfig, "src/main.tsi": src });
    const { done } = lowerAndDerive(root, "src/main.tsi", src);
    expect(done.diagnostics).toEqual([]);
    expect(done.code).toContain(
      'function __nola_type_$1(): import("@nola-lang/runtime").InferType<unknown> { return __nola.types.choice({"billing":"Payments","sales":null}); }',
    );
    expect(done.code).toContain(
      'function __nola_type_$2(): import("@nola-lang/runtime").InferType<unknown> { return __nola.types.scale(["low","high"]); }',
    );
  });
});
