import { describe, expect, it } from "vitest";
import type { AskSummary } from "../src/api";
import { AXIS_KEY, durationSeries, MIN_SLOTS, padSlots } from "../src/duration-series";

const ask = (askId: string, startedAt: number, durationMs?: number): AskSummary => ({
  askId,
  traceId: "t",
  status: "ok",
  startedAt,
  durationMs,
});

describe("durationSeries", () => {
  it("orders executions oldest first", () => {
    const series = durationSeries([ask("b", 2000, 20), ask("a", 1000, 10)]);
    expect(series.map((p) => p.askId)).toEqual(["a", "b"]);
  });

  it("gives executions that start within the same second distinct axis keys", () => {
    const second = new Date(2026, 8, 16, 22, 54, 43).getTime();
    const series = durationSeries([ask("a", second + 100, 199), ask("b", second + 600, 1200)]);
    expect(series[0]?.at).toBe(series[1]?.at);
    // Recharts' axis tooltip resolves the hovered bar with `data.find(e => e[axisKey] === label)`:
    // a shared key answers every bar of that second with the first one's duration.
    for (const point of series) {
      expect(series.find((e) => e[AXIS_KEY] === point[AXIS_KEY])?.duration).toBe(point.duration);
    }
  });

  it("carries the provider, which colours the bar", () => {
    const [known, unknown] = durationSeries([{ ...ask("a", 1000, 10), provider: "mock" }, ask("b", 2000, 10)]);
    expect(known?.provider).toBe("mock");
    expect(unknown).not.toHaveProperty("provider");
  });

  it("charts a running execution at zero", () => {
    expect(durationSeries([ask("a", 1000)])[0]?.duration).toBe(0);
  });

  it("a running execution grows with the clock it is given — it is on the chart before it ends", () => {
    const running = { ...ask("a", 1000), status: "running" as const };
    expect(durationSeries([running], 1750)[0]?.duration).toBe(750);
    // a clock behind the start (two machines, or a late tick) never draws a negative bar
    expect(durationSeries([running], 900)[0]?.duration).toBe(0);
    // a settled execution ignores the clock
    expect(durationSeries([ask("b", 1000, 10)], 99_999)[0]?.duration).toBe(10);
  });
});

describe("padSlots", () => {
  it("fills the chart up to a fixed number of slots, so a new bar takes an empty slot instead of squeezing the others", () => {
    const series = durationSeries([ask("a", 1000, 10), ask("b", 2000, 20)]);
    const padded = padSlots(series);
    expect(padded).toHaveLength(MIN_SLOTS);
    expect(padded.slice(0, 2)).toEqual(series);
    // null, not 0: Recharts drops null values from the tooltip, so hovering an empty slot shows nothing
    expect(padded.slice(2).every((p) => p.slot === true && p.duration === null)).toBe(true);
  });

  it("gives every slot its own axis key, stable as the bars fill in", () => {
    const one = padSlots(durationSeries([ask("a", 1000, 10)]));
    const two = padSlots(durationSeries([ask("a", 1000, 10), ask("b", 2000, 20)]));
    expect(new Set(one.map((p) => p[AXIS_KEY])).size).toBe(MIN_SLOTS);
    // the slot a new bar takes disappears; every other slot keeps its key (and so its place)
    expect(two.slice(2).map((p) => p[AXIS_KEY])).toEqual(one.slice(2).map((p) => p[AXIS_KEY]));
  });

  it("adds nothing once the executions fill the slots", () => {
    const full = durationSeries(Array.from({ length: MIN_SLOTS + 3 }, (_, i) => ask(`a${i}`, 1000 + i, 10)));
    expect(padSlots(full)).toBe(full);
  });
});
