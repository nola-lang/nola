import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import nolaTurbopackLoader from "../src/turbopack-loader.js";

const FIXTURE_TSI = fileURLToPath(new URL("../../../test/e2e/fixtures/next-app/src/greet.tsi", import.meta.url));

function runLoader(resourcePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const ctx = {
      resourcePath,
      async: () => (err: Error | null, code?: string) => (err ? reject(err) : resolve(code ?? "")),
    };
    nolaTurbopackLoader.call(ctx, readFileSync(resourcePath, "utf8"));
  });
}

describe("turbopack loader", () => {
  it("wires the user config with a specifier RELATIVE to the importing file", async () => {
    // Turbopack treats a leading `/` as a server-relative (URL-root) import —
    // "server relative imports are not implemented yet" — so an absolute POSIX
    // path breaks every Linux build while D:/... happens to work on Windows.
    // The loader knows both paths; the specifier must be relative and posix.
    const code = await runLoader(FIXTURE_TSI);
    const m = /import __nola_user_config from "([^"]+)";/.exec(code);
    expect(m, "config import present").not.toBeNull();
    const spec = m?.[1] ?? "";
    expect(spec).toBe("../nola.config.ts");
    expect(spec.startsWith("/")).toBe(false);
    expect(/^[A-Za-z]:\//.test(spec)).toBe(false);
    expect(code).toContain('__nola_rt.configure(__nola_user_config, { source: "nola.config.ts" })');
  });
});
