/** Pure string transforms for the reserved `*.nola.js` companion namespace. */

export function isCompanionSpecifier(s: string): boolean {
  return s.endsWith(".nola.js");
}

/**
 * Forward transform: the specifier the lowerer emits for a type import.
 * `.js`/`.ts` are interchangeable origins (NodeNext vs type-stripping worlds),
 * so both collapse to the extensionless base; `.tsi` and `.d.ts` stay whole so
 * the reverse is exact.
 */
export function companionSpecifierFor(sourceSpecifier: string): string {
  const base = /\.d\.ts$/.test(sourceSpecifier) ? sourceSpecifier : sourceSpecifier.replace(/\.(?:js|ts)$/, "");
  return `${base}.nola.js`;
}

/** Reverse transform: candidate source specifiers, in probe order. */
export function companionSourceCandidates(companionSpecifier: string): string[] {
  const base = companionSpecifier.slice(0, -".nola.js".length);
  if (/\.(?:tsi|d\.ts)$/.test(base)) return [base];
  return [`${base}.ts`, `${base}.tsi`, `${base}.js`];
}

/**
 * Stable identity of the module a specifier points at, relative to the project
 * root — used to qualify ref names so same-named types from different files
 * stay distinct inside one $defs. Pure path arithmetic, no resolution.
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

/** The whole `*.nola.*` filename namespace is reserved (spec invariant 3). */
export function isReservedNolaName(fileName: string): boolean {
  const base = fileName.replace(/\\/g, "/").split("/").pop() ?? "";
  return /\.nola\./.test(base);
}

/** The virtual TS document name for a lowered .tsi file (tshost + editor share it). */
export function loweredVirtualNameFor(file: string): string {
  return `${file.replace(/\\/g, "/")}.ts`;
}
