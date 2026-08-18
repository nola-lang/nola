// Every tsconfig we SHIP (scaffold templates + curated examples) must use a
// directory-style `include`, e.g. ["src"] — never a `.ts`-suffixed glob like
// ["src/**/*.ts"].
//
// Why it matters: the glob's literal `.ts` tail excludes `.tsi` files, so they
// never become project roots. A `.tsi` then enters the program ONLY when some
// plain `.ts` already imports it — which is exactly the case auto-import has
// to solve. TypeScript offers auto-import candidates from files in the
// program, so with the glob shape Ctrl+. over an unimported infer function
// offers "Add missing function declaration" instead of
// `Add import from "./triage.tsi"` (verified against a real tsserver: the two
// include shapes flip that fix on and off, nothing else differs).
//
// Directory-style is safe for plain `tsc`: its supported extensions do not
// include `.tsi`, so tsc still ignores them, while tsserver — where our plugin
// registers `.tsi` as an extra file extension — admits them.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

/**
 * Deliberate exception: this fixture exists to reproduce the TS6 telemetry
 * crash, which requires the `.tsi` to NOT be a tsconfig root and to enter the
 * program through a plain-.ts import (see editor-tsserver-vnext.test.ts).
 */
const INTENTIONAL_GLOB = [join("test", "e2e", "fixtures", "ts6-companions", "tsconfig.json")];

function shippedTsconfigs(): string[] {
  const found: string[] = [];
  const examples = join(ROOT, "examples");
  for (const entry of readdirSync(examples)) {
    const file = join(examples, entry, "tsconfig.json");
    if (statSync(file, { throwIfNoEntry: false })?.isFile()) found.push(file);
  }
  const templates = join(ROOT, "packages", "create-nola-lang", "templates");
  for (const entry of readdirSync(templates)) {
    const file = join(templates, entry, "tsconfig.json");
    if (statSync(file, { throwIfNoEntry: false })?.isFile()) found.push(file);
  }
  return found;
}

describe("shipped tsconfigs let the editor see .tsi files", () => {
  const files = shippedTsconfigs();

  it("finds the templates and examples", () => {
    expect(files.length).toBeGreaterThanOrEqual(10);
  });

  for (const file of files) {
    const relative = file.slice(ROOT.length);
    if (INTENTIONAL_GLOB.some((allowed) => relative.endsWith(allowed))) continue;
    it(`${relative} uses a directory-style include`, () => {
      const include = (JSON.parse(readFileSync(file, "utf8")) as { include?: string[] }).include ?? [];
      expect(include.length).toBeGreaterThan(0);
      for (const pattern of include) {
        expect(pattern, `${pattern} excludes .tsi from the program`).not.toMatch(/\*\.tsx?$/);
      }
    });
  }
});
