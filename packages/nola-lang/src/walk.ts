import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { isReservedNolaName } from "@nola-lang/compiler";

const SKIP = new Set(["node_modules", ".git", "dist"]);

export async function walkProject(dir: string): Promise<{ tsi: string[]; reserved: string[] }> {
  const tsi: string[] = [];
  const reserved: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!SKIP.has(entry.name)) {
        const nested = await walkProject(join(dir, entry.name));
        tsi.push(...nested.tsi);
        reserved.push(...nested.reserved);
      }
    } else if (isReservedNolaName(entry.name)) {
      reserved.push(join(dir, entry.name));
    } else if (entry.name.endsWith(".tsi")) {
      tsi.push(join(dir, entry.name));
    }
  }
  return { tsi: tsi.sort(), reserved: reserved.sort() };
}

export async function findNolaFiles(dir: string): Promise<string[]> {
  return (await walkProject(dir)).tsi;
}
