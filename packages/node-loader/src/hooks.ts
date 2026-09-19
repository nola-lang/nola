import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Codes } from "@nola-lang/ast";
import { viewSourceCandidates } from "@nola-lang/compiler";
import { createDerivationService, type DerivationService } from "@nola-lang/derive";
import { findProjectRoot } from "./project-root.js";
import { NolaTransformError, stripTypes, transformNola } from "./transform.js";

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

/** URL marker of a VIEW module: `file:///…/models.ts?nola-view` serves the derived `models.tsi`. */
const VIEW_QUERY = "?nola-view";

/**
 * One DerivationService per project root (spec §6): the checker that fills in
 * the appendix accessors of every lowered `.tsi` and of every view served.
 * Created on the first `.tsi` the worker sees; the config section reached
 * `initialize` before any load, so the policy is known by then.
 */
const services = new Map<string, DerivationService>();
function serviceFor(file: string): DerivationService {
  const root = rootFor(file);
  let service = services.get(root);
  if (!service) {
    service = createDerivationService({
      projectRoot: root,
      sourceRoot: root,
      underivableContextType: underivableContextType ?? "error",
    });
    services.set(root, service);
  }
  return service;
}

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

const isRelative = (specifier: string): boolean => specifier.startsWith("./") || specifier.startsWith("../");

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
  const fromFile = context.parentURL?.startsWith("file:") === true;
  if (fromFile && isRelative(specifier) && specifier.endsWith(".tsi")) {
    // The *.tsi rule (spec §2): the on-disk .tsi wins; otherwise the VIEW of
    // x.ts / x.d.ts; otherwise NOLA2007. `fileURLToPath` drops a ?nola-view
    // query on the importer, so views import their own neighbours normally.
    const importer = fileURLToPath(context.parentURL as string);
    const target = resolvePath(dirname(importer), specifier);
    if (existsSync(target)) return nextResolve(specifier, context);
    for (const candidate of viewSourceCandidates(target)) {
      if (existsSync(candidate)) return { url: pathToFileURL(candidate).href + VIEW_QUERY, shortCircuit: true };
    }
    throw new Error(
      `${Codes.ViewUnavailable}: "${specifier}" (imported from ${importer}) names neither a Nola file nor a TypeScript module`,
    );
  }
  if (fromFile && isRelative(specifier) && specifier.endsWith(".js")) {
    return resolveWithTsFallback(specifier, context, nextResolve);
  }
  return nextResolve(specifier, context);
}

interface LoadContext {
  format?: string | null;
}
type NextLoad = (
  url: string,
  context: LoadContext,
) => Promise<{ format: string; source: unknown; shortCircuit?: boolean }>;

export async function load(url: string, context: LoadContext, nextLoad: NextLoad) {
  if (url.endsWith(VIEW_QUERY)) {
    const file = fileURLToPath(url.slice(0, -VIEW_QUERY.length));
    const view = serviceFor(file).deriveView(file);
    if (view.code === "" || view.diagnostics.length > 0) throw new NolaTransformError(view.diagnostics);
    // Plain TS with no meaningful original positions — strip types, skip the map.
    return { format: "module", source: stripTypes(view.code, file).code, shortCircuit: true };
  }
  if (!url.endsWith(".tsi")) return nextLoad(url, context);
  const file = fileURLToPath(url);
  const source = await readFile(file, "utf8");
  const { code, map } = await transformNola(source, file, {
    sourceRoot: rootFor(file),
    underivableContextType,
    derive: (f, phase1) => serviceFor(f).derive(f, phase1).answers,
  });
  const withMap = `${code}\n//# sourceMappingURL=data:application/json;base64,${Buffer.from(map).toString("base64")}\n`;
  return { format: "module", source: withMap, shortCircuit: true };
}
