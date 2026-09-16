import { mkdirSync, symlinkSync } from "node:fs";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { capture, ensureBuilt } from "./helpers/ensure-built.js";

const ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const CLI = join(ROOT, "packages", "nola-lang", "dist", "main.js");

// The spec §2 gate: generated code never reads an imported type VALUE during
// module evaluation — only inside a ref closure at schema time — so cyclic
// `.tsi` value imports (and cycles through a view of plain TS) must evaluate,
// ask, and serialize. If this ever fails with a TDZ ReferenceError on a
// `__nola_type_*` binding, make that read lazier; never return to
// function-declaration exports.
const FILES: Record<string, string> = {
  "nola.config.ts": [
    'import { mockProvider } from "@nola-lang/providers";',
    'import { defineConfig } from "@nola-lang/runtime";',
    'export default defineConfig({ model: mockProvider([{ label: "root", b: { label: "leaf" } }]) });',
    "",
  ].join("\n"),
  // .tsi <-> .tsi cycle: A refs B, B refs A
  "src/a.tsi": [
    'import type { B } from "./b.tsi";',
    'import type { C } from "./c.tsi";',
    "export type A = { label: string; b?: B; c?: C };",
    "export infer function go() {",
    "  const a = ask ..`an A`<A>;",
    "  return a;",
    "}",
    "",
  ].join("\n"),
  "src/b.tsi": ['import type { A } from "./a.tsi";', "export type B = { label: string; a?: A };", ""].join("\n"),
  // .tsi <-> view <-> .tsi cycle: c.ts is a plain TS module that refs A
  "src/c.ts": [
    'import type { A } from "./a.tsi";',
    "export type C = { name: string; a?: A };",
    "export const cTag = 1;",
    "",
  ].join("\n"),
  "src/main.ts": [
    'import { A, go } from "./a.tsi";',
    'import { B } from "./b.tsi";',
    'import { C, cTag } from "./c.tsi";',
    "const got = await go();",
    "console.log(JSON.stringify({ a: Object.keys(A.toJsonSchema().$defs ?? {}), b: B.toJsonSchema().type, c: C.toJsonSchema().type, cTag, got, ok: A.validate(got).ok }));",
    "",
  ].join("\n"),
};

describe("circular type imports under the loader (spec §2 gate)", () => {
  let dir: string;
  beforeAll(async () => {
    await ensureBuilt(ROOT);
    dir = await mkdtemp(join(tmpdir(), "nola-view-cycles-"));
    mkdirSync(join(dir, "src"), { recursive: true });
    for (const [rel, text] of Object.entries(FILES)) await writeFile(join(dir, rel), text);
    const scope = join(dir, "node_modules", "@nola-lang");
    mkdirSync(scope, { recursive: true });
    for (const pkg of ["runtime", "providers"]) symlinkSync(join(ROOT, "packages", pkg), join(scope, pkg), "junction");
  }, 300_000);

  it(".tsi <-> .tsi and .tsi <-> view <-> .tsi cycles evaluate, ask, and serialize", { timeout: 120_000 }, async () => {
    const stdout = await capture(process.execPath, [CLI, "run", "src/main.ts"], { cwd: dir });
    const out = JSON.parse(stdout.trim()) as {
      a: string[];
      b: string;
      c: string;
      cTag: number;
      got: unknown;
      ok: boolean;
    };
    expect(out.got).toEqual({ label: "root", b: { label: "leaf" } });
    expect(out.ok).toBe(true);
    // the cycle serialized as $defs (no stack overflow); the exact key set is not the contract
    expect(out.a.length).toBeGreaterThan(0);
    expect(out.b).toBe("object");
    expect(out.c).toBe("object");
    expect(out.cTag).toBe(1); // export * keeps ONE module instance of c.ts
  });
});
