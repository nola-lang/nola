import { useEffect, useMemo, useRef, useState } from "react";
import { Bar, BarChart, Cell, XAxis, YAxis } from "recharts";
import { type ChartConfig, ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { cn } from "@/lib/utils";
import type { AskSummary } from "../api";
import { chartLegend } from "../chart-legend";
import { nextCeiling } from "../chart-scale";
import { AXIS_KEY, type DurationPoint, durationSeries, padSlots } from "../duration-series";
import { formatDuration } from "../format";
import { barColor, providerColors } from "../provider-colors";

const config = {
  duration: { label: "duration", color: "var(--chart-1)" },
} satisfies ChartConfig;

const SWATCH = "inline-block size-2 shrink-0 rounded-[2px]";

/** How often a running execution's bar is redrawn at its new elapsed time — five small steps a second read as steady growth. */
const RUNNING_TICK_MS = 200;

/** Past this many bars the running clock slows to once a second — a tick re-renders the whole chart. */
const CROWDED = 150;

/** While an execution is running, the clock its bar grows by. */
function useRunningClock(running: boolean, tickMs: number): number | undefined {
  const [now, setNow] = useState<number | undefined>(undefined);
  useEffect(() => {
    if (!running) {
      setNow(undefined);
      return;
    }
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), tickMs);
    return () => clearInterval(timer);
  }, [running, tickMs]);
  return now;
}

/**
 * One bar per execution, oldest first. An ok bar wears its provider's colour; a failed or running
 * one keeps the reserved status colour. `providers` is the DEFINITION's list, not the shown
 * executions', so a filter never repaints a provider.
 *
 * Built for executions arriving live: a running one is drawn at its elapsed time and grows until it
 * ends; the chart keeps a fixed number of slots, so a new bar takes an empty one instead of
 * re-laying the rest; and the Y axis holds its ceiling (`scaleKey` names what it is a scale OF — a
 * new definition or filter starts over) instead of rescaling on every update.
 *
 * The bars are NOT animated. Recharts restarts its tween whenever the Bar re-renders with a new
 * props object (every clock tick, stream patch and refetch), pairs old and new bars by index, and
 * keys each bar by its value so it is recreated on change — under live data the tween never
 * finished and read as stutter. With slots and a held ceiling nothing needs to glide anyway: a
 * new bar appears in its slot and a running one steps up with the clock.
 */
export function DurationChart({ asks, providers, scaleKey = "" }: { asks: AskSummary[]; providers: readonly string[]; scaleKey?: string }) {
  const now = useRunningClock(
    asks.some((a) => a.status === "running"),
    asks.length > CROWDED ? 1000 : RUNNING_TICK_MS,
  );
  // memoized on the query result, whose reference is stable across refetches that changed nothing
  const data = useMemo(() => durationSeries(asks, now), [asks, now]);
  const slots = useMemo(() => padSlots(data), [data]);
  const scale = useRef<{ key: string; ceiling: number } | undefined>(undefined);
  const ceiling = nextCeiling(
    scale.current?.key === scaleKey ? scale.current.ceiling : undefined,
    data.reduce((max, d) => Math.max(max, d.duration ?? 0), 0),
  );
  scale.current = { key: scaleKey, ceiling };
  if (data.length === 0) return <p className="font-mono text-muted-foreground text-xs">No executions yet.</p>;
  const clock = new Map(data.map((d) => [d.askId, d.at]));
  const colors = providerColors(providers);
  const legend = chartLegend(data, providers, colors);
  return (
    <>
      <ChartContainer config={config} className="h-40 w-full">
        <BarChart data={slots} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
          <XAxis
            dataKey={AXIS_KEY}
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: 10 }}
            minTickGap={24}
            tickFormatter={(id: string) => clock.get(id) ?? ""}
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            width={44}
            domain={[0, ceiling]}
            tick={{ fontSize: 10 }}
            tickFormatter={(v: number) => formatDuration(v)}
          />
          <ChartTooltip
            cursor={{ fill: "var(--card)" }}
            content={
              <ChartTooltipContent
                hideLabel
                formatter={(value, _name, item) => {
                  const point = item.payload as DurationPoint;
                  if (point.slot) return null; // an empty position has nothing to say
                  return (
                    <span className="flex items-center gap-1.5 font-mono">
                      <span className={SWATCH} style={{ background: barColor(point, colors) }} />
                      <span className="text-muted-foreground">
                        {point.provider ?? "unknown provider"}
                        {point.status === "ok" ? "" : ` · ${point.status}`}
                      </span>
                      <span>{formatDuration(Number(value))}</span>
                    </span>
                  );
                }}
              />
            }
          />
          <Bar dataKey="duration" radius={2} maxBarSize={18} isAnimationActive={false}>
            {slots.map((d) => (
              <Cell key={d.askId} fill={barColor(d, colors)} />
            ))}
          </Bar>
        </BarChart>
      </ChartContainer>
      {/* never conditional: the row keeps its height, so nothing below the chart moves when an execution starts or ends */}
      <ul className="m-0 mt-1.5 flex list-none flex-wrap gap-x-3.5 gap-y-1 p-0 pl-11 font-mono text-[11px] text-muted-foreground">
        {legend.map((entry) => (
          <li
            key={entry.label}
            aria-hidden={!entry.shown}
            className={cn("flex items-center gap-1.5 transition-opacity duration-300", !entry.shown && "opacity-0")}
          >
            <span className={SWATCH} style={{ background: entry.color }} />
            {entry.label}
          </li>
        ))}
      </ul>
    </>
  );
}
