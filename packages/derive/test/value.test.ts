import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { compileNola, finalizeDerivations } from "@nola-lang/compiler";
import { describe, expect, it } from "vitest";
import { createDerivationService } from "../src/service.js";

function project(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "nola-derive-value-"));
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), text);
  }
  return root;
}
const TSCONFIG =
  '{ "compilerOptions": { "strict": true, "module": "NodeNext", "moduleResolution": "NodeNext", "target": "ES2022", "allowArbitraryExtensions": true, "skipLibCheck": true }, "include": ["src"] }';

function derive(main: string) {
  const root = project({ "tsconfig.json": TSCONFIG, "src/main.tsi": main });
  const svc = createDerivationService({ projectRoot: root, sourceRoot: root, underivableContextType: "error" });
  const file = join(root, "src/main.tsi");
  const p1 = compileNola(main, file, { sourceRoot: root });
  const { answers } = svc.derive(file, p1);
  const done = finalizeDerivations(p1, answers, file);
  svc.dispose();
  return done;
}

// A bare value's type (spec 2026-10-12 §3.5): the checker's type of the
// expression, as an optional accessor; underivable → undefined, no diagnostic.
describe("value requests through the DerivationService", () => {
  it("types a variable, a member chain, a literal and a call result", () => {
    const done = derive(
      [
        "type User = { name: string; tags: string[] };",
        "declare const admin: User;",
        "declare const cfg: { defaults: { limit: number } };",
        "declare function count(): number;",
        "const r = ask `use` admin `and` cfg.defaults `and` 42 `and` count() `go`: string;",
        "",
      ].join("\n"),
    );
    expect(done.diagnostics).toEqual([]);
    expect(done.code).toContain(
      'function __nola_type_$2(): import("@nola-lang/runtime").InferType<unknown> | undefined { return __nola.types.ref("User", __nola_type_User); }',
    );
    expect(done.code).toContain(
      'function __nola_type_$3(): import("@nola-lang/runtime").InferType<unknown> | undefined { return __nola.types.object({ limit: __nola.types.number() }); }',
    );
    expect(done.code).toContain(
      'function __nola_type_$4(): import("@nola-lang/runtime").InferType<unknown> | undefined { return __nola.types.literal(42); }',
    );
    expect(done.code).toContain(
      'function __nola_type_$5(): import("@nola-lang/runtime").InferType<unknown> | undefined { return __nola.types.number(); }',
    );
  });

  it("an underivable value (a Map, a Promise) gets an undefined accessor and no diagnostic", () => {
    const done = derive(
      "declare const m: Map<string, number>;\ndeclare const p: Promise<string>;\nconst r = ask `use` m `and` p `go`: string;\n",
    );
    expect(done.diagnostics).toEqual([]);
    expect(done.code).toContain(
      'function __nola_type_$2(): import("@nola-lang/runtime").InferType<unknown> | undefined { return undefined; }',
    );
    expect(done.code).toContain(
      'function __nola_type_$3(): import("@nola-lang/runtime").InferType<unknown> | undefined { return undefined; }',
    );
  });
});
