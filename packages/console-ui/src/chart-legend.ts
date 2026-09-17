import type { DurationPoint } from "./duration-series";

export interface LegendEntry {
  label: string;
  color: string | undefined;
  /** false = keep the entry's place but draw it invisible */
  shown: boolean;
}

/**
 * The key under the duration chart. One provider needs no key (the stat
 * line names it) and only providers ON the chart get one; `error` joins once
 * a failed execution is shown.
 *
 * `running` is ALWAYS the last entry, shown or not. Under a live chart an
 * execution starts and ends many times a minute: an entry that came and went
 * with it made the legend row — often the only entry in it — appear and
 * disappear, and everything below the chart jumped by a line each time. An
 * always-present last entry keeps the row's height and every other entry's
 * place.
 */
export function chartLegend(data: readonly DurationPoint[], providers: readonly string[], colors: ReadonlyMap<string, string>): LegendEntry[] {
  const onChart = new Set(data.map((d) => d.provider));
  return [
    ...(providers.length > 1 ? providers.filter((p) => onChart.has(p)).map((p) => ({ label: p, color: colors.get(p), shown: true })) : []),
    ...(data.some((d) => d.status === "error") ? [{ label: "error", color: "var(--err)", shown: true }] : []),
    { label: "running", color: "var(--live)", shown: data.some((d) => d.status === "running") },
  ];
}
