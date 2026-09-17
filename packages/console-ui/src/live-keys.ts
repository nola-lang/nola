/** A TanStack query-key PREFIX: invalidating it refetches every mounted query under it. */
export type QueryKeyPrefix = readonly string[];

const ASK_LISTS: readonly QueryKeyPrefix[] = [["projects"], ["records"], ["trace"], ["definitions"], ["definition"]];
const INVOCATION_LISTS: readonly QueryKeyPrefix[] = [["projects"], ["records"], ["trace"]];
const MID_ASK = new Set(["providerRequest", "providerResponse", "validationFailed", "retry"]);

/**
 * Which queries one live notice can have changed. An ask emits four or more
 * events; only its start and end move the lists and the definition chart —
 * the provider round trip in between changes that ask's detail and nothing
 * else, so it must not refetch every list in the app. Anything unrecognized
 * answers "all": a wasted refetch is cheap, a stale view is a bug.
 */
export function queryKeysFor(notice: unknown): readonly QueryKeyPrefix[] | "all" {
  if (notice === null || typeof notice !== "object") return "all";
  const { kind, event } = notice as { kind?: unknown; event?: unknown };
  if (typeof kind !== "string") return "all";
  if (kind === "invocationStart" || kind === "invocationEnd") return INVOCATION_LISTS;
  const askId = (event as { askId?: unknown } | null | undefined)?.askId;
  if (typeof askId !== "string") return "all";
  if (kind === "askStart" || kind === "askEnd") return [...ASK_LISTS, ["ask", askId]];
  if (MID_ASK.has(kind)) return [["ask", askId]];
  return "all";
}

/** The union of several notices' keys, each prefix once, in first-seen order. */
export function mergeQueryKeys(all: ReadonlyArray<readonly QueryKeyPrefix[] | "all">): readonly QueryKeyPrefix[] | "all" {
  const seen = new Map<string, QueryKeyPrefix>();
  for (const keys of all) {
    if (keys === "all") return "all";
    for (const key of keys) seen.set(JSON.stringify(key), key);
  }
  return [...seen.values()];
}
