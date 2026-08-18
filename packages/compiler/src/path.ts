/** Backslashes → posix, and no trailing slash. */
function toPosix(p: string): string {
  return p.replace(/\\/g, "/").replace(/\/+$/, "");
}

/**
 * The path baked into lowered output (`file:` fields, `__nola.context.file(...)`).
 *
 * Absolute paths would leak the build machine's layout into `dist/` and make builds
 * non-reproducible across checkouts, so emit a posix-separated path relative to the
 * project root instead. Nothing at run time resolves this string — it is a memo key
 * for `fileContext` and a label in errors, logs, and receipts.
 *
 * Falls back to the input when there is no root, or when the file sits outside it
 * (a `../..` chain is no more portable than the absolute path it came from). Callers
 * derive `file` and `sourceRoot` from the same `resolve()`/`fileURLToPath()` pass, so
 * a plain prefix match is enough — no need for `node:path`, which this package (alone
 * among the build-time ones) does not depend on.
 */
export function displayPathFor(file: string, sourceRoot?: string): string {
  if (!sourceRoot) return file;
  const root = toPosix(sourceRoot);
  if (root === "") return file;
  const posix = file.replace(/\\/g, "/");
  return posix.startsWith(`${root}/`) ? posix.slice(root.length + 1) : file;
}
