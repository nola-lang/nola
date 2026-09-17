import { describe, expect, it } from "vitest";
import type { AskSummary, DefinitionDetail } from "../src/api";
import { applyNotice } from "../src/live-definition";

const DEF = "d".repeat(64);

const ask = (askId: string, startedAt: number, over: Partial<AskSummary> = {}): AskSummary => ({
  askId,
  traceId: "t",
  def: DEF,
  status: "ok",
  startedAt,
  durationMs: 10,
  provider: "openai",
  ...over,
});

const detail = (asks: AskSummary[], over: Partial<DefinitionDetail> = {}): DefinitionDetail => ({
  def: DEF,
  firstSeenAt: 1000,
  lastSeenAt: 2000,
  executions: asks.length,
  okCount: asks.length,
  errorCount: 0,
  providers: ["openai"],
  asks,
  matched: asks.length,
  ...over,
});

const envelope = (kind: string, at: number, event: unknown, pid = 7) => ({ v: 1, runId: "r1", pid, seq: 0, at, kind, event });
const start = (askId: string, at: number, over: Record<string, unknown> = {}) =>
  envelope("askStart", at, { askId, def: DEF, provider: "openai", site: { file: "src/a.tsi", loc: "3:9" }, spanPath: ["inv1", "inv2"], kind: "extract", ...over });
const end = (askId: string, at: number, receipt: Record<string, unknown> = {}) =>
  envelope("askEnd", at, { askId, receipt: { def: DEF, servedBy: "openai", durationMs: 420, attempts: 1, outcome: { ok: true }, ...receipt } });

describe("applyNotice", () => {
  it("an ask starting appears at once as a running execution, newest first", () => {
    const before = detail([ask("a1", 1500)]);
    const after = applyNotice(before, {}, start("a2", 3000));
    expect(after.asks.map((a) => a.askId)).toEqual(["a2", "a1"]);
    expect(after.asks[0]).toEqual({
      askId: "a2",
      traceId: "inv1",
      pid: 7,
      def: DEF,
      kind: "extract",
      site: "src/a.tsi:3:9",
      provider: "openai",
      status: "running",
      startedAt: 3000,
    });
    expect(after.executions).toBe(2);
    expect(after.matched).toBe(2);
    expect(after.lastSeenAt).toBe(3000);
  });

  it("the ask ending settles that execution: status, duration, attempts, the provider that served", () => {
    const running = applyNotice(detail([ask("a1", 1500)]), {}, start("a2", 3000));
    const after = applyNotice(running, {}, end("a2", 3420, { servedBy: "anthropic", attempts: 2 }));
    expect(after.asks[0]).toMatchObject({ askId: "a2", status: "ok", durationMs: 420, attempts: 2, provider: "anthropic", startedAt: 3000 });
    expect(after.executions).toBe(2);
    expect(after.okCount).toBe(2);
    // the definition's provider list stays sorted — its order decides the bar colours
    expect(after.providers).toEqual(["anthropic", "openai"]);
  });

  it("a failed ask settles as an error with its message", () => {
    const running = applyNotice(detail([]), {}, start("a1", 3000));
    const after = applyNotice(running, {}, end("a1", 3100, { outcome: { ok: false, error: "boom" } }));
    expect(after.asks[0]).toMatchObject({ status: "error", error: "boom" });
    expect(after.errorCount).toBe(1);
    expect(after.okCount).toBe(0);
  });

  it("is idempotent — a notice re-applied over refetched data changes nothing", () => {
    const once = applyNotice(applyNotice(detail([]), {}, start("a1", 3000)), {}, end("a1", 3420));
    const twice = applyNotice(applyNotice(once, {}, start("a1", 3000)), {}, end("a1", 3420));
    expect(twice).toBe(once);
  });

  it("a late start never downgrades a settled execution", () => {
    const settled = applyNotice(detail([]), {}, end("a1", 3420));
    expect(settled.asks[0]).toMatchObject({ askId: "a1", status: "ok", durationMs: 420 });
    expect(applyNotice(settled, {}, start("a1", 3000)).asks[0]).toMatchObject({ status: "ok", durationMs: 420 });
  });

  it("returns the SAME object for a notice that is not this definition's", () => {
    const before = detail([ask("a1", 1500)]);
    expect(applyNotice(before, {}, start("x", 3000, { def: "e".repeat(64) }))).toBe(before);
    expect(applyNotice(before, {}, envelope("providerRequest", 3000, { askId: "a1", attempt: 1 }))).toBe(before);
    expect(applyNotice(before, {}, envelope("invocationEnd", 3000, { invocationId: "i" }))).toBe(before);
    expect(applyNotice(before, {}, null)).toBe(before);
  });

  it("respects the executions filter the way storage does", () => {
    const before = detail([]);
    // outside the time window, or another process: not shown, and nothing else is guessed at —
    // the stat line is the refetch's to settle, which keeps re-applying a notice harmless
    for (const query of [{ from: 5000 }, { to: 2000 }, { pid: 99 }]) {
      expect(applyNotice(before, query, start("a1", 3000))).toBe(before);
    }
    // a duration bound skips an execution that has no duration yet…
    const running = applyNotice(before, { dmin: 100 }, start("a1", 3000));
    expect(running).toBe(before);
    // …and admits it once it ends inside the bound
    const ended = applyNotice(running, { dmin: 100 }, end("a1", 3420));
    expect(ended.asks.map((a) => a.askId)).toEqual(["a1"]);
    expect(ended.matched).toBe(1);
    expect(ended.executions).toBe(1);
    // …or keeps it out when it ends outside
    expect(applyNotice(running, { dmin: 1000 }, end("a1", 3420)).asks).toEqual([]);
  });

  it("an execution that ends outside a duration bound leaves the shown list", () => {
    const shown = applyNotice(detail([]), {}, start("a1", 3000));
    const after = applyNotice(shown, { dmax: 100 }, end("a1", 3420));
    expect(after.asks).toEqual([]);
    expect(after.matched).toBe(0);
  });

  it("keeps the list inside the server's cap by dropping the oldest", () => {
    const full = detail(Array.from({ length: 500 }, (_, i) => ask(`a${i}`, 2000 - i)));
    const after = applyNotice(full, {}, start("new", 3000));
    expect(after.asks).toHaveLength(500);
    expect(after.asks[0]?.askId).toBe("new");
    expect(after.asks.at(-1)?.askId).toBe("a498");
    expect(after.matched).toBe(501);
  });
});
