import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRefreshQueue } from "../src/refresh-queue";

/** A flush the test settles by hand: each call records its batch and hands back the resolver. */
function manualFlush() {
  const batches: string[][] = [];
  const settle: Array<() => void> = [];
  const flush = (items: string[]) => {
    batches.push(items);
    return new Promise<void>((resolve) => settle.push(resolve));
  };
  return { batches, settle, flush };
}

describe("createRefreshQueue", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("flushes the first item at once — no waiting for a quiet gap", () => {
    const { batches, flush } = manualFlush();
    createRefreshQueue({ flush, minGapMs: 100 }).push("a");
    expect(batches).toEqual([["a"]]);
  });

  it("keeps flushing under continuous traffic: a steady stream never starves the refresh", async () => {
    const batches: string[][] = [];
    const queue = createRefreshQueue({ flush: async (items: string[]) => void batches.push(items), minGapMs: 100 });
    // one event every 50 ms for a second — the old trailing debounce (250 ms) fired ZERO times here
    for (let i = 0; i < 20; i++) {
      queue.push(`e${i}`);
      await vi.advanceTimersByTimeAsync(50);
    }
    expect(batches.length).toBeGreaterThanOrEqual(9);
    expect(batches.flat()).toHaveLength(20);
  });

  it("collapses what arrives inside the gap into ONE trailing batch", async () => {
    const batches: string[][] = [];
    const queue = createRefreshQueue({ flush: async (items: string[]) => void batches.push(items), minGapMs: 100 });
    queue.push("a");
    queue.push("b");
    queue.push("c");
    expect(batches).toEqual([["a"]]);
    await vi.advanceTimersByTimeAsync(100);
    expect(batches).toEqual([["a"], ["b", "c"]]);
  });

  it("never runs two flushes at once: the next waits for the one in flight, then carries everything that arrived", async () => {
    const { batches, settle, flush } = manualFlush();
    const queue = createRefreshQueue({ flush, minGapMs: 100 });
    queue.push("a");
    queue.push("b");
    await vi.advanceTimersByTimeAsync(500); // the gap is long over, the first flush is still in flight
    queue.push("c");
    expect(batches).toEqual([["a"]]);
    settle[0]?.();
    await vi.advanceTimersByTimeAsync(0);
    expect(batches).toEqual([["a"], ["b", "c"]]);
  });

  it("a failed flush does not wedge the queue", async () => {
    let calls = 0;
    const queue = createRefreshQueue({
      flush: async () => {
        calls++;
        if (calls === 1) throw new Error("network");
      },
      minGapMs: 100,
    });
    queue.push("a");
    queue.push("b");
    await vi.advanceTimersByTimeAsync(100);
    expect(calls).toBe(2);
  });

  it("dispose drops what is pending and stops the timer", async () => {
    const batches: string[][] = [];
    const queue = createRefreshQueue({ flush: async (items: string[]) => void batches.push(items), minGapMs: 100 });
    queue.push("a");
    queue.push("b");
    queue.dispose();
    await vi.advanceTimersByTimeAsync(1000);
    expect(batches).toEqual([["a"]]);
  });
});
