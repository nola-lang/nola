import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { resolve } from "../src/hooks.js";

/**
 * Mirrors Node's default resolver closely enough for the fallback seam: a
 * relative specifier resolves against the importer's directory and throws
 * ERR_MODULE_NOT_FOUND when nothing is on disk at exactly that path.
 */
function fakeNextResolve(existing: Set<string>) {
  const calls: string[] = [];
  const next = async (specifier: string, context: { parentURL?: string }) => {
    calls.push(specifier);
    const parent = context.parentURL;
    if (specifier.startsWith(".") && parent?.startsWith("file:")) {
      const p = join(fileURLToPath(parent), "..", specifier);
      if (existing.has(p)) return { url: pathToFileURL(p).href };
      const err = new Error(`Cannot find module '${p}'`) as Error & { code: string };
      err.code = "ERR_MODULE_NOT_FOUND";
      throw err;
    }
    const err = new Error(`Cannot find package '${specifier}'`) as Error & { code: string };
    err.code = "ERR_MODULE_NOT_FOUND";
    throw err;
  };
  return { next, calls };
}

async function projectDir(files: string[]): Promise<{ dir: string; parentURL: string; existing: Set<string> }> {
  const dir = await mkdtemp(join(tmpdir(), "nola-resolve-"));
  const existing = new Set<string>();
  for (const name of files) {
    const p = join(dir, name);
    await writeFile(p, "export const x = 1;\n");
    existing.add(p);
  }
  return { dir, parentURL: pathToFileURL(join(dir, "main.tsi")).href, existing };
}

describe("resolve .js→.ts fallback", () => {
  it("resolves ./x.js to the on-disk x.ts when no .js exists", async () => {
    const { dir, parentURL, existing } = await projectDir(["handlers.ts"]);
    const { next } = fakeNextResolve(existing);
    const result = await resolve("./handlers.js", { parentURL }, next);
    expect(result.url).toBe(pathToFileURL(join(dir, "handlers.ts")).href);
  });

  it("prefers a real on-disk .js over the .ts sibling", async () => {
    const { dir, parentURL, existing } = await projectDir(["handlers.js", "handlers.ts"]);
    const { next, calls } = fakeNextResolve(existing);
    const result = await resolve("./handlers.js", { parentURL }, next);
    expect(result.url).toBe(pathToFileURL(join(dir, "handlers.js")).href);
    expect(calls).toEqual(["./handlers.js"]);
  });

  it("rethrows the original .js error when the .ts sibling is missing too", async () => {
    const { parentURL, existing } = await projectDir([]);
    const { next } = fakeNextResolve(existing);
    await expect(resolve("./handlers.js", { parentURL }, next)).rejects.toThrow(/handlers\.js/);
  });

  it("does not probe .ts for bare package specifiers", async () => {
    const { parentURL, existing } = await projectDir([]);
    const { next, calls } = fakeNextResolve(existing);
    await expect(resolve("some-pkg/x.js", { parentURL }, next)).rejects.toThrow(/some-pkg/);
    expect(calls).toEqual(["some-pkg/x.js"]);
  });

  it("propagates non-ERR_MODULE_NOT_FOUND failures untouched", async () => {
    const { parentURL } = await projectDir(["handlers.ts"]);
    const calls: string[] = [];
    const next = async (specifier: string, _context: { parentURL?: string }) => {
      calls.push(specifier);
      const err = new Error("invalid specifier") as Error & { code: string };
      err.code = "ERR_INVALID_MODULE_SPECIFIER";
      throw err;
    };
    await expect(resolve("./handlers.js", { parentURL }, next)).rejects.toThrow("invalid specifier");
    expect(calls).toEqual(["./handlers.js"]);
  });
});
