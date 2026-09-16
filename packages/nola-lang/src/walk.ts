import { readdir } from "node:fs/promises";
import { basename, join } from "node:path";

const SKIP = new Set(["node_modules", ".git", "dist"]);

export interface SiblingPair {
  ts: string;
  tsi: string;
}

/** All .tsi files plus same-basename .ts/.tsi pairs (spec decision 5: allowed, warned). */
export async function walkProject(dir: string): Promise<{ tsi: string[]; siblings: SiblingPair[] }> {
  const tsi: string[] = [];
  const siblings: SiblingPair[] = [];
  const entries = await readdir(dir, { withFileTypes: true });
  const names = new Set(entries.filter((e) => e.isFile()).map((e) => e.name));
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!SKIP.has(entry.name)) {
        const nested = await walkProject(join(dir, entry.name));
        tsi.push(...nested.tsi);
        siblings.push(...nested.siblings);
      }
    } else if (entry.name.endsWith(".tsi")) {
      const file = join(dir, entry.name);
      tsi.push(file);
      const twin = `${entry.name.slice(0, -".tsi".length)}.ts`;
      if (names.has(twin)) siblings.push({ ts: join(dir, twin), tsi: file });
    }
  }
  return { tsi: tsi.sort(), siblings: siblings.sort((a, b) => a.tsi.localeCompare(b.tsi)) };
}

/** The non-fatal warning line build/check print for a same-basename pair (`./x.tsi` always means the Nola file). */
export function siblingWarning({ ts, tsi }: SiblingPair): string {
  const name = basename(tsi, ".tsi");
  return `${ts} and ${tsi} share a basename — "./${name}.tsi" resolves to the Nola file; the plain module is reachable only as "./${name}.js"`;
}

export async function findNolaFiles(dir: string): Promise<string[]> {
  return (await walkProject(dir)).tsi;
}
