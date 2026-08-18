import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { registerNola } from "@nola-lang/node-loader";

export async function cmdRun(entryArg: string): Promise<number> {
  if (!entryArg) {
    console.error("nola run <entry>");
    return 1;
  }
  const entry = resolve(entryArg);
  await registerNola({ dir: dirname(entry) });
  await import(pathToFileURL(entry).href);
  return 0;
}
