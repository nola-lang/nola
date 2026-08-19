import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * `npm create nola` is a name alias of `npm create nola-lang` (decided
 * 2026-08-18): the bin only imports create-nola-lang's bin module. This pins
 * the two halves of that contract — the alias imports the `./main` subpath,
 * and create-nola-lang keeps exporting it.
 */
describe("create-nola alias", () => {
  it("the bin forwards to create-nola-lang/main", () => {
    const bin = readFileSync(new URL("../bin/main.js", import.meta.url), "utf8");
    expect(bin.startsWith("#!/usr/bin/env node\n")).toBe(true);
    expect(bin).toContain('import "create-nola-lang/main";');
  });

  it("create-nola-lang exports the ./main subpath", () => {
    const manifest = JSON.parse(readFileSync(new URL("../../create-nola-lang/package.json", import.meta.url), "utf8")) as {
      exports: Record<string, unknown>;
    };
    expect(manifest.exports["./main"]).toBe("./dist/main.js");
  });
});
