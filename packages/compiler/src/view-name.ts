/**
 * The `*.tsi` rule as pure string transforms (spec §2): a relative `./x.tsi`
 * names the on-disk `.tsi` when it exists, otherwise the derived VIEW of
 * `x.ts` (then `x.d.ts`). Hosts do the probing; these helpers only spell
 * the candidates.
 */

export function isTsiSpecifier(specifier: string): boolean {
  return specifier.endsWith(".tsi") && (specifier.startsWith("./") || specifier.startsWith("../"));
}

/** Forward transform: the specifier generated code imports a type's value from. */
export function viewSpecifierFor(sourceSpecifier: string): string {
  if (sourceSpecifier.endsWith(".tsi")) return sourceSpecifier;
  return `${sourceSpecifier.replace(/\.d\.ts$|\.(?:js|ts)$/, "")}.tsi`;
}

/** Reverse transform: type sources a missing `<base>.tsi` may be a view of, in probe order. */
export function viewSourceCandidates(tsiPath: string): string[] {
  const base = tsiPath.slice(0, -".tsi".length);
  return [`${base}.ts`, `${base}.d.ts`];
}

/** The NodeNext specifier a view re-exports its source through (`export * from "./models.js"`). */
export function viewSourceSpecifierFor(viewSourceFile: string): string {
  const name = viewSourceFile.replace(/\\/g, "/").split("/").pop() ?? "";
  return `./${name.replace(/\.d\.ts$|\.ts$/, "")}.js`;
}

/**
 * Stable identity of the module a specifier points at, relative to the project
 * root — qualifies ref names so same-named types from different files stay
 * distinct inside one $defs. Pure path arithmetic, no resolution.
 */
export function moduleIdFor(importerDisplayFile: string, specifier: string): string {
  const stack = importerDisplayFile.replace(/\\/g, "/").split("/").slice(0, -1);
  for (const part of specifier.replace(/\\/g, "/").split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") stack.pop();
    else stack.push(part);
  }
  return stack.join("/").replace(/\.(?:tsi|ts|js)$/, "");
}

/** The virtual TS document name for a lowered .tsi file (tshost + editor share it). */
export function loweredVirtualNameFor(file: string): string {
  return `${file.replace(/\\/g, "/")}.ts`;
}

// Pure posix path arithmetic — this package deliberately has no `node:path`
// dependency (see path.ts). Used by the Turbopack inline path to re-relativize
// a view's own `.tsi` imports to the importing file.

/** posix dirname of a posix- or backslash-separated path (`"."` when there is none). */
export function posixDirname(p: string): string {
  const s = p.replace(/\\/g, "/");
  const i = s.lastIndexOf("/");
  return i < 0 ? "." : i === 0 ? "/" : s.slice(0, i);
}

/** `dir` + a relative specifier, `.`/`..` normalized; a leading `/` or drive prefix survives. */
export function posixJoin(dir: string, specifier: string): string {
  const stack = dir.replace(/\\/g, "/").split("/");
  for (const part of specifier.replace(/\\/g, "/").split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") stack.pop();
    else stack.push(part);
  }
  return stack.join("/");
}

/** The `./`-prefixed relative specifier that reaches `to` from `fromDir` (both absolute posix paths). */
export function posixRelative(fromDir: string, to: string): string {
  const from = fromDir.replace(/\\/g, "/").split("/").filter((s) => s !== "");
  const target = to.replace(/\\/g, "/").split("/").filter((s) => s !== "");
  let common = 0;
  while (common < from.length && common < target.length && from[common] === target[common]) common++;
  const ups = from.slice(common).map(() => "..");
  const rel = [...ups, ...target.slice(common)].join("/");
  return rel.startsWith(".") ? rel : `./${rel}`;
}
