import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { companionSourceCandidates, compileCompanion, isCompanionSpecifier } from "@nola-lang/compiler";
import { transform } from "esbuild";
import { findProjectRoot } from "./config.js";
import { NolaTransformError, transformNola } from "./transform.js";

// The hooks run in Node's module-hooks worker, which `register()` gives no project
// context. Walk up for the root here, memoized per directory — a `.tsi` import graph
// is many files across few directories.
const roots = new Map<string, string>();
function rootFor(file: string): string {
  const dir = dirname(file);
  let root = roots.get(dir);
  if (root === undefined) {
    root = findProjectRoot(dir);
    roots.set(dir, root);
  }
  return root;
}

const COMPANION_QUERY = "?nola-companion";

// Compile-time config, delivered by registerNola through `register` data (the
// hooks worker cannot see the main thread's config object). Absent data —
// e.g. hooks registered without registerNola — falls back to the compiler
// default, which matches an unconfigured project.
let underivableContextType: "error" | "prune" | "omit" | undefined;

export function initialize(data?: { compiler?: { underivableContextType?: "error" | "prune" | "omit" } }): void {
  underivableContextType = data?.compiler?.underivableContextType;
}

interface ResolveContext {
  parentURL?: string;
}
type NextResolve = (specifier: string, context: ResolveContext) => Promise<{ url: string; shortCircuit?: boolean }>;

/**
 * Companion specifiers name modules that never exist on disk — default
 * resolution would throw ERR_MODULE_NOT_FOUND before `load` ran. Recognize the
 * reserved suffix, probe the type-source candidates next to the importer, and
 * short-circuit to a marked URL the `load` hook synthesizes from.
 */
/**
 * NodeNext convention: plain TS written for tsc says `./x.js` while only
 * `x.ts` is on disk. Node's native type-stripping refuses that mapping, so
 * when default resolution finds nothing, retry once with a `.ts` tail — a
 * real `.js` always won already, and a miss rethrows the original error.
 */
async function resolveWithTsFallback(specifier: string, context: ResolveContext, nextResolve: NextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (err) {
    if ((err as { code?: string }).code !== "ERR_MODULE_NOT_FOUND") throw err;
    try {
      return await nextResolve(`${specifier.slice(0, -".js".length)}.ts`, context);
    } catch {
      throw err;
    }
  }
}

export async function resolve(specifier: string, context: ResolveContext, nextResolve: NextResolve) {
  if (!isCompanionSpecifier(specifier) || !specifier.startsWith(".") || !context.parentURL?.startsWith("file:")) {
    if (specifier.endsWith(".js") && specifier.startsWith(".") && context.parentURL?.startsWith("file:")) {
      return resolveWithTsFallback(specifier, context, nextResolve);
    }
    return nextResolve(specifier, context);
  }
  const importerDir = dirname(fileURLToPath(context.parentURL));
  const literal = resolvePath(importerDir, specifier);
  if (existsSync(literal)) {
    // Never silently shadow: a real on-disk *.nola.* file is a reserved-namespace violation.
    throw new Error(`NOLA2006: ${literal} matches the reserved *.nola.* companion namespace — rename the file.`);
  }
  for (const candidate of companionSourceCandidates(specifier)) {
    const p = resolvePath(importerDir, candidate);
    if (existsSync(p)) {
      return { url: pathToFileURL(p).href + COMPANION_QUERY, shortCircuit: true };
    }
  }
  throw new Error(
    `NOLA2007: cannot locate the type source for "${specifier}" imported from ${fileURLToPath(context.parentURL)}`,
  );
}

interface LoadContext {
  format?: string | null;
}
type NextLoad = (
  url: string,
  context: LoadContext,
) => Promise<{ format: string; source: unknown; shortCircuit?: boolean }>;

export async function load(url: string, context: LoadContext, nextLoad: NextLoad) {
  if (url.endsWith(COMPANION_QUERY)) {
    const file = fileURLToPath(url.slice(0, -COMPANION_QUERY.length));
    const source = await readFile(file, "utf8");
    const companion = compileCompanion(source, file, { sourceRoot: rootFor(file) });
    if (companion.code === "" || companion.diagnostics.length > 0) {
      throw new NolaTransformError(companion.diagnostics);
    }
    // Plain TS with no meaningful original positions — strip types, skip the map.
    // Async `transform` for the same worker-thread reason documented in transform.ts.
    const js = await transform(companion.code, { loader: "ts", format: "esm" });
    return { format: "module", source: js.code, shortCircuit: true };
  }
  if (!url.endsWith(".tsi")) return nextLoad(url, context);
  const file = fileURLToPath(url);
  const source = await readFile(file, "utf8");
  const { code, map } = await transformNola(source, file, { sourceRoot: rootFor(file), underivableContextType });
  const withMap = `${code}\n//# sourceMappingURL=data:application/json;base64,${Buffer.from(map).toString("base64")}\n`;
  return { format: "module", source: withMap, shortCircuit: true };
}
