import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { unpluginFactory } from "../src/index.js";

type WithBuildStart = { buildStart?: (this: unknown) => Promise<void> };

function tmpProject(): string {
  const dir = mkdtempSync(join(tmpdir(), "nola-declopt-"));
  writeFileSync(join(dir, "nola.config.ts"), "export default {};\n");
  writeFileSync(join(dir, "greet.tsi"), "export infer function g() {\n  return ask ..`x`<string>;\n}\n");
  return dir;
}

describe("declarations option", () => {
  it("buildStart emits adjacent d.tsi.ts when a root is passed explicitly", async () => {
    const dir = tmpProject();
    const p = unpluginFactory({ root: dir }, { framework: "rollup" } as never) as WithBuildStart;
    await p.buildStart?.call({});
    expect(existsSync(join(dir, "greet.d.tsi.ts"))).toBe(true);
  });

  it("transform emits for the .tsi's OWN project root, never process.cwd()", async () => {
    // cwd is the monorepo during tests — precisely the layout that must not be walked.
    const dir = tmpProject();
    const p = unpluginFactory({}, { framework: "rollup" } as never) as WithBuildStart & {
      transform?: (this: unknown, source: string, id: string) => Promise<unknown>;
    };
    const ctx = {
      error: (m: unknown): never => {
        throw m instanceof Error ? m : new Error(String(m));
      },
      addWatchFile: () => {},
    };
    const source = "export infer function g() {\n  return ask ..`x`<string>;\n}\n";
    await p.transform?.call(ctx, source, join(dir, "greet.tsi"));
    expect(existsSync(join(dir, "greet.d.tsi.ts"))).toBe(true);
    expect(existsSync(join(process.cwd(), "greet.d.tsi.ts"))).toBe(false);
  });

  it("declarations:false skips the emit", async () => {
    const dir = tmpProject();
    const p = unpluginFactory({ root: dir, declarations: false }, { framework: "rollup" } as never) as WithBuildStart;
    await p.buildStart?.call({});
    expect(existsSync(join(dir, "greet.d.tsi.ts"))).toBe(false);
  });
});
