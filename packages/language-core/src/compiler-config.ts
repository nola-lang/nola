import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { type StaticContextTypeMode, staticUnderivableContextType } from "@nola-lang/compiler";

/** The compile-relevant slice of nola.config.ts as the editor sees it. */
export interface EditorCompilerConfig {
  underivableContextType?: StaticContextTypeMode;
}

const cache = new Map<string, { mtimeMs: number; value: EditorCompilerConfig }>();

/**
 * Editor-side view of `compiler.*` in nola.config.ts: the nearest config up
 * from the script, STATICALLY parsed (editor processes never execute user
 * config; see staticUnderivableContextType for what that can and cannot see).
 * Cached by config path + mtime — cheap enough to call on every compile, so
 * config edits land on the next recompile without a restart.
 */
export function discoverCompilerConfig(fileName: string): EditorCompilerConfig {
  const configPath = findUp(dirname(fileName));
  if (!configPath) return {};
  let mtimeMs: number;
  try {
    mtimeMs = statSync(configPath).mtimeMs;
  } catch {
    return {};
  }
  const hit = cache.get(configPath);
  if (hit && hit.mtimeMs === mtimeMs) return hit.value;
  let value: EditorCompilerConfig = {};
  try {
    value = { underivableContextType: staticUnderivableContextType(readFileSync(configPath, "utf8")) };
  } catch {
    // unreadable: behave like no config
  }
  cache.set(configPath, { mtimeMs, value });
  return value;
}

function findUp(startDir: string): string | null {
  let dir = startDir;
  for (;;) {
    const candidate = join(dir, "nola.config.ts");
    try {
      if (existsSync(candidate)) return candidate;
    } catch {
      return null;
    }
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}
