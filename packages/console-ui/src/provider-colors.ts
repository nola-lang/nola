import type { AskStatus } from "./format";

/**
 * How many `--provider-N` tokens index.css defines. Five is not arbitrary: with red, amber and
 * green reserved for status, it is the most colours that stay pairwise distinguishable on this
 * surface for colour-blind readers too (bars of different providers sit next to each other in any
 * order, so every pair counts). More providers than slots rotate — the legend and the tooltip
 * name the provider, so colour never carries identity alone.
 */
export const PROVIDER_SLOTS = 5;

const NEUTRAL = "var(--chart-4)";

/** FNV-1a — small, stable across sessions, good enough to spread a handful of names. */
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

/**
 * provider → colour token. The colour follows the PROVIDER, not its rank in the list: each one
 * prefers the slot its name hashes to, so it looks the same in every definition and a filter never
 * repaints it. Only a collision moves a provider (to the next free slot, resolved in name order so
 * the outcome does not depend on the input order); past {@link PROVIDER_SLOTS} slots are shared.
 */
export function providerColors(providers: readonly string[]): Map<string, string> {
  const taken = new Set<number>();
  const colors = new Map<string, string>();
  for (const provider of [...new Set(providers)].sort()) {
    let slot = hash(provider) % PROVIDER_SLOTS;
    if (taken.size < PROVIDER_SLOTS) while (taken.has(slot)) slot = (slot + 1) % PROVIDER_SLOTS;
    taken.add(slot);
    colors.set(provider, `var(--provider-${slot + 1})`);
  }
  return colors;
}

/** Status is reserved and wins: only an ok execution wears its provider's colour. */
export function barColor(point: { status: AskStatus; provider?: string }, colors: ReadonlyMap<string, string>): string {
  if (point.status === "error") return "var(--err)";
  if (point.status === "running") return "var(--live)";
  return (point.provider !== undefined ? colors.get(point.provider) : undefined) ?? NEUTRAL;
}
