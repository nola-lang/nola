import { describe, expect, it } from "vitest";
import { chartLegend } from "../src/chart-legend";
import type { DurationPoint } from "../src/duration-series";

const point = (status: DurationPoint["status"], provider?: string): DurationPoint => ({ askId: `${status}-${provider}`, at: "", duration: 1, status, ...(provider ? { provider } : {}) });
const colors = new Map([
  ["anthropic", "var(--provider-1)"],
  ["openai", "var(--provider-2)"],
]);

describe("chartLegend", () => {
  it("always ends with the running entry — shown or not — so the legend row never appears or disappears under a live chart", () => {
    const idle = chartLegend([point("ok", "openai")], ["openai"], colors);
    expect(idle).toEqual([{ label: "running", color: "var(--live)", shown: false }]);
    const busy = chartLegend([point("ok", "openai"), point("running", "openai")], ["openai"], colors);
    expect(busy).toEqual([{ label: "running", color: "var(--live)", shown: true }]);
  });

  it("keeps every other entry in place when running toggles", () => {
    const data = [point("ok", "openai"), point("ok", "anthropic"), point("error", "openai")];
    const idle = chartLegend(data, ["anthropic", "openai"], colors);
    const busy = chartLegend([...data, point("running", "openai")], ["anthropic", "openai"], colors);
    expect(idle.map((e) => e.label)).toEqual(["anthropic", "openai", "error", "running"]);
    expect(busy.map((e) => e.label)).toEqual(idle.map((e) => e.label));
    expect(idle.slice(0, 3)).toEqual(busy.slice(0, 3));
  });

  it("one provider needs no key, and only providers on the chart get one", () => {
    expect(chartLegend([point("ok", "openai")], ["openai"], colors).map((e) => e.label)).toEqual(["running"]);
    expect(chartLegend([point("ok", "openai")], ["anthropic", "openai"], colors).map((e) => e.label)).toEqual(["openai", "running"]);
  });
});
