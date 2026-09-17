import type { QueryClient } from "@tanstack/react-query";
import type { DefinitionAsksQuery, DefinitionDetail } from "./api";
import { applyNotice } from "./live-definition";
import { mergeQueryKeys, queryKeysFor } from "./live-keys";
import { createRefreshQueue } from "./refresh-queue";

/** The shortest time between two refetch rounds — a burst of events is one round trip. */
const MIN_REFRESH_GAP_MS = 100;

export interface LiveSync {
  /** One notice off the event stream: an ingest envelope, `{ kind: "cleared" }`, or `null` for "anything may have changed". */
  onNotice(notice: unknown): void;
  dispose(): void;
}

/**
 * Keeps the query cache in step with the event stream, in two layers:
 *
 * 1. PATCH — each notice is applied to every cached definition at once
 *    (`applyNotice`), so an execution is on screen the moment it starts and
 *    settles the moment it ends, with no round trip.
 * 2. REFETCH — the notice then names the queries it can have changed and the
 *    refresh queue refetches them, self-paced. The server stays the truth.
 *
 * A refetch can answer with a read taken BEFORE a notice that arrived while
 * it was in flight; written over the patch, that execution would blink out
 * until the next round. So every notice since a round began is re-applied
 * when the round settles — `applyNotice` is idempotent, which makes that safe.
 */
export function createLiveSync(queryClient: QueryClient, options: { minGapMs?: number } = {}): LiveSync {
  let sinceRoundBegan: unknown[] = [];

  const patch = (notice: unknown): void => {
    for (const query of queryClient.getQueryCache().findAll({ queryKey: ["definition"] })) {
      const current = query.state.data as DefinitionDetail | undefined;
      if (current === undefined) continue;
      const next = applyNotice(current, (query.queryKey[2] ?? {}) as DefinitionAsksQuery, notice);
      if (next !== current) queryClient.setQueryData(query.queryKey, next);
    }
  };

  const queue = createRefreshQueue<unknown>({
    minGapMs: options.minGapMs ?? MIN_REFRESH_GAP_MS,
    flush: async (notices) => {
      sinceRoundBegan = [];
      try {
        const keys = mergeQueryKeys(notices.map(queryKeysFor));
        if (keys === "all") await queryClient.invalidateQueries();
        else await Promise.all(keys.map((queryKey) => queryClient.invalidateQueries({ queryKey })));
      } finally {
        for (const notice of sinceRoundBegan) patch(notice);
      }
    },
  });

  return {
    onNotice(notice) {
      sinceRoundBegan.push(notice);
      patch(notice);
      queue.push(notice);
    },
    dispose: () => queue.dispose(),
  };
}
