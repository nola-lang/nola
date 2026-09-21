import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { type StaticContextTypeMode, staticUnderivableContextType } from "@nola-lang/compiler";

/** The compile-relevant slice of nola.config.ts as the editor sees it. */
export interface EditorCompilerConfig {
  underivableContextType?: StaticContextTypeMode;
}

/**
 * How long the LOCATION of the nearest config (found or not) is trusted for a
 * start directory before the ancestor walk runs again. A config created or
 * removed lands within this window; an EDIT lands on the next call regardless
 * (the mtime check is not memoized).
 */
export const CONFIG_DISCOVERY_TTL_MS = 2_000;

const cache = new Map<string, { mtimeMs: number; value: EditorCompilerConfig }>();
const located = new Map<string, { at: number; configPath: string | null }>();

/**
 * Editor-side view of `compiler.*` in nola.config.ts: the nearest config up
 * from the script, STATICALLY parsed (editor processes never execute user
 * config; see staticUnderivableContextType for what that can and cannot see).
 *
 * Called on EVERY compile of every open file — each keystroke — so it is
 * cheap by construction: the ancestor walk (one existsSync per directory) is
 * memoized per start directory for CONFIG_DISCOVERY_TTL_MS, and a located
 * config costs one statSync per call, re-parsed only when its mtime moved.
 * `now` is injectable for tests.
 */
export function discoverCompilerConfig(fileName: string, now: number = Date.now()): EditorCompilerConfig {
  const startDir = dirname(fileName);
  let hit = located.get(startDir);
  if (!hit || now - hit.at > CONFIG_DISCOVERY_TTL_MS || now < hit.at) {
    hit = { at: now, configPath: findUp(startDir) };
    located.set(startDir, hit);
  }
  const configPath = hit.configPath;
  if (!configPath) return {};
  let mtimeMs: number;
  try {
    mtimeMs = statSync(configPath).mtimeMs;
  } catch {
    // removed since it was located: forget the location so the next call walks again
    located.delete(startDir);
    cache.delete(configPath);
    return {};
  }
  const cached = cache.get(configPath);
  if (cached && cached.mtimeMs === mtimeMs) return cached.value;
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
