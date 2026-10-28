import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = fileURLToPath(new URL("../src/", import.meta.url));

// The node-loader INDEX imports `stripTypeScriptTypes` from node:module statically, which Bun
// does not export — importing it fails at link time under Bun. Only the runtime-free
// `/project-root` subpath may be used here.
describe("@nola-lang/bun import rules", () => {
  it("never imports the @nola-lang/node-loader index, and never a stripper", () => {
    for (const file of readdirSync(SRC).filter((f) => f.endsWith(".ts"))) {
      const text = readFileSync(join(SRC, file), "utf8");
      expect(text, file).not.toMatch(/from "@nola-lang\/node-loader"/);
      expect(text, file).not.toMatch(/stripTypeScriptTypes|ts-blank-space|esbuild/);
    }
  });
});
