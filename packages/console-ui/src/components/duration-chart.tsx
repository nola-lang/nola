import { Bar, BarChart, Cell, XAxis, YAxis } from "recharts";
import { type ChartConfig, ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import type { AskSummary } from "../api";
import { formatClock, formatDuration } from "../format";

const config = {
  duration: { label: "duration", color: "var(--chart-1)" },
} satisfies ChartConfig;

const TONE = { ok: "var(--ok)", error: "var(--err)", running: "var(--live)" } as const;

/** One bar per execution, oldest first, coloured by outcome. */
export function DurationChart({ asks }: { asks: AskSummary[] }) {
  const data = [...asks]
    .sort((a, b) => a.startedAt - b.startedAt)
    .map((ask) => ({ askId: ask.askId, at: formatClock(ask.startedAt), duration: ask.durationMs ?? 0, status: ask.status }));
  if (data.length === 0) return <p className="font-mono text-muted-foreground text-xs">No executions yet.</p>;
  return (
    <ChartContainer config={config} className="h-40 w-full">
      <BarChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
        <XAxis dataKey="at" tickLine={false} axisLine={false} tick={{ fontSize: 10 }} minTickGap={24} />
        <YAxis
          tickLine={false}
          axisLine={false}
          width={44}
          tick={{ fontSize: 10 }}
          tickFormatter={(v: number) => formatDuration(v)}
        />
        <ChartTooltip
          cursor={{ fill: "var(--card)" }}
          content={<ChartTooltipContent hideLabel formatter={(value) => formatDuration(Number(value))} />}
        />
        <Bar dataKey="duration" radius={2} maxBarSize={18}>
          {data.map((d) => (
            <Cell key={d.askId} fill={TONE[d.status]} />
          ))}
        </Bar>
      </BarChart>
    </ChartContainer>
  );
}
