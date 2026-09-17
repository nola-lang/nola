import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import type { DefinitionDetail } from "../src/api";
import { createLiveSync } from "../src/live-sync";

const DEF = "d".repeat(64);
const KEY = ["definition", DEF, {}] as const;

const detail = (askIds: string[]): DefinitionDetail => ({
  def: DEF,
  firstSeenAt: 0,
  lastSeenAt: 0,
  executions: askIds.length,
  okCount: askIds.length,
  errorCount: 0,
  providers: [],
  matched: askIds.length,
  asks: askIds.map((askId, i) => ({ askId, traceId: "t", def: DEF, status: "ok" as const, startedAt: 1000 - i, durationMs: 5 })),
});
const start = (askId: string, at: number) => ({ v: 1, runId: "r", pid: 1, seq: 0, at, kind: "askStart", event: { askId, def: DEF } });

/** A mounted definition query whose server answers are handed out by the test. */
async function mounted(first: DefinitionDetail) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: Number.POSITIVE_INFINITY, retry: false } } });
  const answers: Array<(d: DefinitionDetail) => void> = [];
  const queryFn = vi.fn(() => new Promise<DefinitionDetail>((resolve) => answers.push(resolve)));
  // an observer keeps the query "active", so invalidation refetches it like a mounted component would
  const unsubscribe = new QueryObserver(queryClient, { queryKey: KEY, queryFn }).subscribe(() => {});
  await vi.waitFor(() => expect(answers).toHaveLength(1));
  answers[0]?.(first);
  await vi.waitFor(() => expect(queryClient.getQueryData(KEY)).toEqual(first));
  const shown = () => (queryClient.getQueryData(KEY) as DefinitionDetail).asks.map((a) => a.askId);
  return { queryClient, answers, queryFn, shown, unsubscribe };
}

describe("createLiveSync", () => {
  it("shows a starting ask in the cache at once — before any refetch answers", async () => {
    const { queryClient, shown, unsubscribe } = await mounted(detail(["a1"]));
    const sync = createLiveSync(queryClient, { minGapMs: 0 });
    sync.onNotice(start("a2", 2000));
    expect(shown()).toEqual(["a2", "a1"]);
    sync.dispose();
    unsubscribe();
  });

  it("follows the patch with a refetch, which is the truth", async () => {
    const { queryClient, answers, shown, unsubscribe } = await mounted(detail(["a1"]));
    const sync = createLiveSync(queryClient, { minGapMs: 0 });
    sync.onNotice(start("a2", 2000));
    await vi.waitFor(() => expect(answers).toHaveLength(2));
    answers[1]?.(detail(["a2", "a1", "a0"]));
    await vi.waitFor(() => expect(shown()).toEqual(["a2", "a1", "a0"]));
    sync.dispose();
    unsubscribe();
  });

  it("an ask that starts while a refetch is in flight survives that refetch's (older) answer", async () => {
    const { queryClient, answers, shown, unsubscribe } = await mounted(detail(["a1"]));
    const sync = createLiveSync(queryClient, { minGapMs: 0 });
    sync.onNotice(start("a2", 2000));
    await vi.waitFor(() => expect(answers).toHaveLength(2));
    sync.onNotice(start("a3", 3000)); // arrives mid-round
    expect(shown()).toEqual(["a3", "a2", "a1"]);
    answers[1]?.({ ...detail(["a2", "a1"]), asks: detail(["a2", "a1"]).asks.map((a) => (a.askId === "a2" ? { ...a, startedAt: 2000 } : a)) }); // read before a3 was ingested
    await vi.waitFor(() => expect(answers).toHaveLength(3)); // the next round is already asking again
    expect(shown()).toEqual(["a3", "a2", "a1"]);
    sync.dispose();
    unsubscribe();
  });
});
