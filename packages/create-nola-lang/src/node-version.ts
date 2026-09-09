/**
 * The Node floor the docs state. Plain `.ts` (the templates' `src/main.ts`)
 * is loaded by Node's native type stripping, which is on by default only from
 * 22.18 on the 22 line and 23.6 on the 23 line; before that it sits behind
 * `--experimental-strip-types` and the default loader rejects `.ts` outright
 * (ERR_UNKNOWN_FILE_EXTENSION) — `npm start` and the F5 launch both die on
 * it, with nothing naming Nola. Nola does not paper over the gap with its own
 * stripping (esbuild accepts syntax Node's stripper refuses, so a project
 * would work on the old Node and break on the upgrade); it tells the user at
 * scaffold time instead. `nola run` and the loader also run on Node ≥ 22.18.
 */
export const NODE_FLOOR = "22.18";

function parse(version: string): [number, number] | undefined {
  const m = /^v?(\d+)\.(\d+)/.exec(version);
  return m ? [Number(m[1]), Number(m[2])] : undefined;
}

/** Whether this Node runs `.ts` files natively without a flag. */
export function nodeSupportsTypeStripping(version: string): boolean {
  const v = parse(version);
  if (!v) return true; // unparsable: do not nag on what we cannot read
  const [major, minor] = v;
  if (major >= 24) return true;
  if (major === 23) return minor >= 6;
  if (major === 22) return minor >= 18;
  return false;
}

/** Whether `--experimental-strip-types` exists on this Node (22.6+, 23.x before 23.6). */
function hasStripTypesFlag(version: string): boolean {
  const v = parse(version);
  if (!v) return false;
  const [major, minor] = v;
  return major > 22 || (major === 22 && minor >= 6);
}

/**
 * The scaffold-time advice for an unsupported Node, or undefined when the
 * running Node is fine. Printed as a note by `npm create nola` and `nola init`
 * (both go through `runFlow`) so the user hears it before the first
 * `npm start`, not from Node's bare error.
 */
export function nodeVersionWarning(version: string = process.versions.node): string | undefined {
  if (nodeSupportsTypeStripping(version)) return undefined;
  const lines = [
    `Node ${version} is older than Nola needs: Node >= ${NODE_FLOOR}, the first release that runs .ts files natively.`,
    "On this Node, `npm start` and the VS Code F5 launch fail with ERR_UNKNOWN_FILE_EXTENSION for src/main.ts.",
  ];
  if (hasStripTypesFlag(version)) {
    lines.push(
      "Upgrade Node (recommended), or set NODE_OPTIONS=--experimental-strip-types for `npm start` and add",
      '"--experimental-strip-types" to runtimeArgs in .vscode/launch.json.',
    );
  } else {
    lines.push("Upgrade Node: https://nodejs.org/");
  }
  return lines.join("\n");
}
