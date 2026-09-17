export interface RefreshQueue<T> {
  push(item: T): void;
  /** Drop what is pending and stop the timer; a flush already in flight is left to finish. */
  dispose(): void;
}

/**
 * Self-pacing refresh: the first item flushes AT ONCE, and everything that
 * arrives while a flush is in flight — or inside `minGapMs` of the last one
 * starting — rides the next flush as one batch. At most one flush runs at a
 * time, so a slow refetch is never cancelled by the next event, and the
 * queue always ends with a flush that carries the last item.
 *
 * It replaces a trailing debounce, which under a steady event stream (a run
 * of asks never leaves a quiet gap) did not fire until the stream paused.
 */
export function createRefreshQueue<T>(options: { flush: (items: T[]) => Promise<unknown>; minGapMs: number }): RefreshQueue<T> {
  const { flush, minGapMs } = options;
  let pending: T[] = [];
  let inFlight = false;
  let disposed = false;
  let lastStart = Number.NEGATIVE_INFINITY;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const run = (): void => {
    timer = undefined;
    if (disposed || inFlight || pending.length === 0) return;
    const items = pending;
    pending = [];
    inFlight = true;
    lastStart = Date.now();
    const settled = (): void => {
      inFlight = false;
      schedule();
    };
    flush(items).then(settled, settled);
  };

  const schedule = (): void => {
    if (disposed || inFlight || timer !== undefined || pending.length === 0) return;
    const wait = lastStart + minGapMs - Date.now();
    if (wait <= 0) run();
    else timer = setTimeout(run, wait);
  };

  return {
    push(item) {
      if (disposed) return;
      pending.push(item);
      schedule();
    },
    dispose() {
      disposed = true;
      pending = [];
      clearTimeout(timer);
    },
  };
}
