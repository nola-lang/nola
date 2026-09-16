import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compileNola, finalizeDerivations } from "@nola-lang/compiler";
import { createDerivationService } from "@nola-lang/derive";
import { describe, expect, it } from "vitest";
import { inlineViews } from "../src/inline-views.js";

function project(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "nola-inline-"));
  writeFileSync(join(root, "nola.config.ts"), "export default {};\n");
  mkdirSync(join(root, "src"), { recursive: true });
  for (const [rel, text] of Object.entries(files)) writeFileSync(join(root, rel), text);
  return root;
}

describe("inlineViews (Turbopack)", () => {
  it("replaces a view import with the view's finalized accessors under a per-module prefix, transitively; a real .tsi stays an import", () => {
    const report = [
      'import type { Person } from "./models.js";',
      'import type { Shape } from "./shapes.tsi";',
      "type Both = { p: Person; s: Shape };",
      "export const i = ..`who`<Both>;",
      "",
    ].join("\n");
    const root = project({
      "src/geo.ts": "export interface Country { code: string }\n",
      "src/models.ts": 'import type { Country } from "./geo.js";\nexport interface Person { name: string; country: Country }\n',
      "src/shapes.tsi": "export type Shape = { kind: string };\n",
      "src/report.tsi": report,
    });
    const service = createDerivationService({ projectRoot: root, sourceRoot: root, underivableContextType: "error" });
    const file = join(root, "src", "report.tsi");
    const p1 = compileNola(report, file, { sourceRoot: root });
    const done = finalizeDerivations(p1, service.derive(file, p1).answers, file);
    expect(done.code).toContain('from "./models.tsi"');
    const out = inlineViews(done, file, root, service);
    service.dispose();

    expect(out.code).not.toContain('from "./models.tsi"');
    expect(out.code).not.toContain('from "./geo.tsi"');
    expect(out.code).toContain(
      'function __nola_type_Person(): import("@nola-lang/runtime").InferType<unknown> { return __nola_view_src_models_Person(); }',
    );
    expect(out.code).toContain(
      'function __nola_view_src_models_Person(): import("@nola-lang/runtime").InferType<unknown> { return __nola.types.object({ name: __nola.types.string(), country: __nola.types.ref("src/geo#Country", () => __nola_view_src_models_Country) }); }',
    );
    // the view's own view import (geo) was inlined in turn under geo's prefix
    expect(out.code).toContain("function __nola_view_src_models_Country(): import(\"@nola-lang/runtime\").InferType<unknown> { return __nola_view_src_geo_Country(); }");
    expect(out.code).toContain("function __nola_view_src_geo_Country(): import(\"@nola-lang/runtime\").InferType<unknown> { return __nola.types.object({ code: __nola.types.string() }); }");
    // the real .tsi keeps its import, relative to the loaded file
    expect(out.code).toContain('import { Shape as __nola_type_Shape } from "./shapes.tsi";');
    expect(out.meta.views).toEqual(["./shapes.tsi"]);
    expect(out.code.slice(0, out.meta.appendixStart)).toBe(done.code.slice(0, done.meta.appendixStart));
    expect(out.code).not.toContain("(undefined as never)");
  });

  it("a cyclic pair of views inlines each once", () => {
    const root = project({
      "src/a.ts": 'import type { B } from "./b.js";\nexport interface A { b?: B }\n',
      "src/b.ts": 'import type { A } from "./a.js";\nexport interface B { a?: A }\n',
      "src/use.tsi": 'import type { A } from "./a.js";\nexport const i = ..`a`<A>;\n',
    });
    const service = createDerivationService({ projectRoot: root, sourceRoot: root, underivableContextType: "error" });
    const file = join(root, "src", "use.tsi");
    const src = 'import type { A } from "./a.js";\nexport const i = ..`a`<A>;\n';
    const p1 = compileNola(src, file, { sourceRoot: root });
    const out = inlineViews(finalizeDerivations(p1, service.derive(file, p1).answers, file), file, root, service);
    service.dispose();
    expect(out.code.match(/function __nola_view_src_a_A\(\)/g)).toHaveLength(1);
    expect(out.code.match(/function __nola_view_src_b_B\(\)/g)).toHaveLength(1);
    expect(out.code).not.toMatch(/from "\.\.?\/[^"]*\.tsi"/); // no .tsi import survives (the file-ctx path is not an import)
  });
});
