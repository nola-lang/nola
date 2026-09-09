/** A search string with `patch` applied: string sets, undefined deletes; other params survive. */
export function withSearch(current: URLSearchParams, patch: Record<string, string | undefined>): string {
  const next = new URLSearchParams(current);
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) next.delete(key);
    else next.set(key, value);
  }
  const s = next.toString();
  return s === "" ? "" : `?${s}`;
}
