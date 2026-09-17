import type { AskSummary } from "./api";
import { type AskStatus, formatClock } from "./format";

export interface DurationPoint {
  askId: string;
  /** the tick label — second precision, so NOT unique across executions */
  at: string;
  /** null only on an empty slot — Recharts draws no bar and lists nothing in the tooltip for it */
  duration: number | null;
  status: AskStatus;
  provider?: string;
  /** an empty bar position (see {@link padSlots}) — no execution behind it */
  slot?: true;
}

/**
 * The field the chart's category axis is keyed on. It must be unique per point: Recharts' axis
 * tooltip resolves the hovered bar with `data.find(e => e[axisKey] === label)`, so keying on the
 * clock label answers every bar of one second with that second's FIRST duration.
 */
export const AXIS_KEY = "askId" satisfies keyof DurationPoint;

/**
 * One point per execution, oldest first. With a clock, a RUNNING execution is
 * drawn at its elapsed time so far — it is on the chart from the moment it
 * starts and grows until it ends; without one it charts at zero.
 */
export function durationSeries(asks: AskSummary[], now?: number): DurationPoint[] {
  return [...asks]
    .sort((a, b) => a.startedAt - b.startedAt)
    .map((ask) => ({
      askId: ask.askId,
      at: formatClock(ask.startedAt),
      duration: ask.durationMs ?? (ask.status === "running" && now !== undefined ? Math.max(0, now - ask.startedAt) : 0),
      status: ask.status,
      ...(ask.provider !== undefined ? { provider: ask.provider } : {}),
    }));
}

/** How many bar positions the chart always has. Few executions leave the rest empty instead of stretching. */
export const MIN_SLOTS = 40;

/**
 * Pad the series with empty slots up to {@link MIN_SLOTS}. The category axis
 * divides its width by the number of points, so without padding every new
 * execution re-lays every bar; with it a new bar takes the next empty slot
 * and nothing else moves. A slot's axis key is its POSITION, so the slots
 * that remain keep their keys as the bars fill in.
 */
export function padSlots(points: DurationPoint[]): DurationPoint[] {
  if (points.length >= MIN_SLOTS) return points;
  const slots = Array.from({ length: MIN_SLOTS - points.length }, (_, i): DurationPoint => ({
    askId: `slot:${points.length + i}`,
    at: "",
    duration: null,
    status: "ok",
    slot: true,
  }));
  return [...points, ...slots];
}
