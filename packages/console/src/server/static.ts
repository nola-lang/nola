import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative, sep } from "node:path";

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".png": "image/png",
  ".woff2": "font/woff2",
};

export interface UiAsset {
  body: Uint8Array;
  type: string;
}

/**
 * Read a built Vite output into an in-memory URL map at startup. The bundle
 * is small; a frozen map avoids path traversal and per-request fs entirely.
 * Undefined when the directory has no index.html (running from src, or the
 * UI was not built) — the caller falls back to the placeholder page.
 */
export function loadUiAssets(dir: string): Map<string, UiAsset> | undefined {
  let entries: string[];
  try {
    entries = walk(dir);
  } catch {
    return undefined;
  }
  const map = new Map<string, UiAsset>();
  for (const file of entries) {
    const url = `/${relative(dir, file).split(sep).join("/")}`;
    const type = TYPES[extname(file)] ?? "application/octet-stream";
    map.set(url, { body: readFileSync(file), type });
  }
  const index = map.get("/index.html");
  if (!index) return undefined;
  map.set("/", index);
  return map;
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}
