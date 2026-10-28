// The ONE place a library package touches Node. Every read is at call time and guarded, so a
// browser bundle of core, compiler, derive, runtime, providers or language-core carries no
// `node:` import and no `process` global; where Node is absent each read degrades to an honest
// answer — no environment, no pid, no working directory, no builtin module, no TTY.
// `process.getBuiltinModule` is Node ≥ 22.3 (the floor is 22.18): a builtin is reached without a
// static import, which is what keeps the specifier out of a bundler's resolution.

interface ProcessLike {
  env?: Record<string, string | undefined>;
  pid?: number;
  cwd?: () => string;
  getBuiltinModule?: (id: string) => unknown;
  stderr?: { isTTY?: boolean; write?: (text: string) => unknown };
}

const proc = (): ProcessLike | undefined => (globalThis as { process?: ProcessLike }).process;

/** `process.env[name]`, else undefined. */
export function readEnv(name: string): string | undefined {
  return proc()?.env?.[name];
}

/** `process.pid`, else 0. */
export function processId(): number {
  return proc()?.pid ?? 0;
}

/** `process.cwd()`, else undefined. */
export function workingDirectory(): string | undefined {
  return proc()?.cwd?.();
}

/** A Node builtin (`node:fs`, `node:path`, `node:module`, …) through `process.getBuiltinModule`, else undefined. */
export function nodeBuiltin<T>(id: `node:${string}`): T | undefined {
  const get = proc()?.getBuiltinModule;
  return typeof get === "function" ? (get(id) as T | undefined) : undefined;
}

/**
 * Why a Node-only ability (a builtin module) is unavailable here, for a refusal's message: no
 * `process` at all is a browser; a `process` without `getBuiltinModule` is Node 22.0–22.2 (the
 * library packages' floor is 22.3) — or a browser carrying a `process` shim, which looks the same.
 */
export function nodeAbsenceReason(): string {
  if (!proc()) return "there is no Node here (a browser)";
  return "process.getBuiltinModule is missing: Node >= 22.3 is required (or `process` is a shim)";
}

/** `process.stderr.isTTY === true`. */
export function stderrIsTty(): boolean {
  return proc()?.stderr?.isTTY === true;
}

/** `process.stderr.write(text)`, else `console.error` of the text without its trailing newline. */
export function writeStderr(text: string): void {
  const stderr = proc()?.stderr;
  if (typeof stderr?.write === "function") {
    stderr.write(text);
    return;
  }
  console.error(text.endsWith("\n") ? text.slice(0, -1) : text);
}
