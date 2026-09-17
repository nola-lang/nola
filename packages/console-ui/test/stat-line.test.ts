import { describe, expect, it } from "vitest";
import type { DefinitionSummary } from "../src/api";
import { defStatLine } from "../src/stat-line";

const NBSP = " ";
const def = (over: Partial<DefinitionSummary>): DefinitionSummary => ({
  def: "d",
  firstSeenAt: 0,
  lastSeenAt: 0,
  executions: 0,
  okCount: 0,
  errorCount: 0,
  providers: [],
  ...over,
});

describe("defStatLine", () => {
  it("reads runs · ok share · avg · p95", () => {
    expect(defStatLine(def({ executions: 210, okCount: 210, avgDurationMs: 240, p95DurationMs: 388 }))).toBe("210 runs · 100% ok · avg 240ms · p95 388ms");
    expect(defStatLine(def({ executions: 1, okCount: 1, avgDurationMs: 240, p95DurationMs: 388 }))).toMatch(/^1 run ·/);
  });

  it("the ok share is of SETTLED executions — one still running is not a failure, so the share does not dip while it runs", () => {
    const settled = def({ executions: 50, okCount: 50, avgDurationMs: 240, p95DurationMs: 388 });
    const withRunning = def({ ...settled, executions: 53 }); // three more started, none ended
    expect(defStatLine(withRunning)).toContain("100% ok");
    expect(defStatLine(def({ executions: 53, okCount: 45, errorCount: 5 }))).toContain(`${NBSP}90% ok`);
  });

  it("says so when nothing has settled yet", () => {
    expect(defStatLine(def({ executions: 2 }))).toBe(`2 runs · ${NBSP}${NBSP}—% ok · avg ${NBSP}${NBSP}${NBSP}${NBSP}— · p95 ${NBSP}${NBSP}${NBSP}${NBSP}—`);
  });

  it("holds its width: a value that gets shorter or longer does not move what follows it", () => {
    const lines = [
      def({ executions: 210, okCount: 210, avgDurationMs: 240, p95DurationMs: 388 }),
      def({ executions: 210, okCount: 208, errorCount: 2, avgDurationMs: 95, p95DurationMs: 1240 }),
      def({ executions: 210, okCount: 100, errorCount: 110, avgDurationMs: 7, p95DurationMs: 12_300 }),
    ].map(defStatLine);
    expect(new Set(lines.map((l) => l.length)).size).toBe(1);
    expect(new Set(lines.map((l) => l.indexOf("· avg"))).size).toBe(1);
    expect(new Set(lines.map((l) => l.indexOf("· p95"))).size).toBe(1);
    // padding is NO-BREAK space: HTML collapses ordinary runs of spaces, which would undo it
    expect(lines[2]).toContain(`avg ${NBSP}${NBSP}7ms`);
  });
});
