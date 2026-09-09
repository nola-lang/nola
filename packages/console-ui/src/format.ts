export type AskStatus = "running" | "ok" | "error";

export function formatDuration(ms: number | undefined): string {
  if (ms === undefined) return "—";
  const whole = Math.round(ms);
  if (whole < 1000) return `${whole}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function formatClock(at: number): string {
  const d = new Date(at);
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function statusClass(status: AskStatus): string {
  if (status === "running") return "dot dot-live";
  if (status === "ok") return "dot dot-ok";
  return "dot dot-err";
}
