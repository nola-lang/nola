import type { NolaIngestEnvelope } from "./nola-protocol.js";

/** The role → style functions a line is rendered with. Colour never changes the text: strip the escapes and the plain line remains. */
export interface LinePalette {
  dim: (s: string) => string;
  command: (s: string) => string;
  path: (s: string) => string;
  ok: (s: string) => string;
  warn: (s: string) => string;
  error: (s: string) => string;
}

const id = (s: string): string => s;
export const plainPalette: LinePalette = Object.freeze({ dim: id, command: id, path: id, ok: id, warn: id, error: id });

const sgr = (open: number, close: number) => (s: string) => `\u001b[${open}m${s}\u001b[${close}m`;
/** The same roles in ANSI colour — what a TTY sees; strip the escapes and `plainPalette`'s line remains. */
export const ansiPalette: LinePalette = Object.freeze({
  dim: sgr(2, 22),
  command: sgr(36, 39),
  path: sgr(1, 22),
  ok: sgr(32, 39),
  warn: sgr(33, 39),
  error: sgr(31, 39),
});

/** What the console process prints one line for: an ingested envelope, or the UI's "cleared" notice. */
export type IngestLineNotice = NolaIngestEnvelope | { kind: "cleared"; at: number };

/** Shapes the line formatter reads out of the (untyped) wire events — the same ones the console's reducer reads. */
type Site = { file?: string; loc?: string };
type StartEvent = { site?: Site; provider?: string; instruction?: string };
type AttemptEvent = { attempt?: number; provider?: string; profile?: string; durationMs?: number };
type ProblemEvent = { attempt?: number; error?: string; reason?: string };
type EndEvent = {
  receipt?: { site?: Site; servedBy?: string; attempts?: number; durationMs?: number; outcome?: { ok?: boolean; error?: string } };
};
type InvocationStartEvent = { fn?: string; file?: string };
type InvocationEndEvent = { trace?: { fn?: string; file?: string } };

const INSTRUCTION_MAX = 72;
const KIND_WIDTH = 6;

const siteText = (site?: Site): string => (site?.file && site.loc ? `${site.file}:${site.loc}` : "<unknown>");
const pad2 = (n: number): string => String(n).padStart(2, "0");

/** Local wall-clock time of the event, `HH:MM:SS.mmm` — the way every tracing tool opens a line. */
function timeText(at: number): string {
  const d = new Date(at);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}.${String(d.getMilliseconds()).padStart(3, "0")}`;
}

/** One line, whitespace collapsed, cut to INSTRUCTION_MAX characters. */
function excerpt(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > INSTRUCTION_MAX ? `${flat.slice(0, INSTRUCTION_MAX - 1)}…` : flat;
}

const attempts = (n: number | undefined): string => (n !== undefined && n > 1 ? `, ${n} attempts` : "");

/**
 * One ingested envelope → one log line, the way tracing tools show spans:
 * time, kind, then what happened. Ask-level events (start, end, invocation
 * end) sit at column 0; attempt-level events (request, reply, validation,
 * retry) indent under their ask. Colour is by role and never changes the
 * text: strip the escapes and the plain line is what remains.
 */
export function formatIngestLine(notice: IngestLineNotice, p: LinePalette = plainPalette): string {
  const kind = (label: string, color: (s: string) => string, nested = false): string =>
    nested ? `  ${color(label.padEnd(KIND_WIDTH - 2))}` : color(label.padEnd(KIND_WIDTH));
  if (notice.kind === "cleared") return `${p.dim(timeText(notice.at))} ${kind("clear", p.warn)} all traces removed`;
  const envelope = notice;
  const head = `${p.dim(timeText(envelope.at))}${envelope.project ? ` ${p.dim(envelope.project)}` : ""}`;
  const event = envelope.event as Record<string, unknown>;
  switch (envelope.kind) {
    case "askStart": {
      const e = event as StartEvent;
      const instruction = e.instruction ? ` — ${excerpt(e.instruction)}` : "";
      return `${head} ${kind("ask", p.command)} ${p.path(siteText(e.site))} via ${e.provider ?? "?"}${instruction}`;
    }
    case "providerRequest": {
      const e = event as AttemptEvent;
      const profile = e.profile ? ` (${e.profile})` : "";
      return `${head} ${kind("req", p.dim, true)} #${e.attempt ?? "?"} → ${e.provider ?? "?"}${profile}`;
    }
    case "providerResponse": {
      const e = event as AttemptEvent;
      return `${head} ${kind("res", p.dim, true)} #${e.attempt ?? "?"} ← ${e.provider ?? "?"} ${e.durationMs ?? "?"}ms`;
    }
    case "validationFailed": {
      const e = event as ProblemEvent;
      return `${head} ${kind("warn", p.warn, true)} #${e.attempt ?? "?"} validation failed: ${e.error ?? ""}`;
    }
    case "retry": {
      const e = event as ProblemEvent;
      return `${head} ${kind("retry", p.warn, true)} after #${e.attempt ?? "?"}: ${e.reason ?? ""}`;
    }
    case "askEnd": {
      const r = (event as EndEvent).receipt;
      const ok = r?.outcome?.ok !== false;
      const summary = `${p.path(siteText(r?.site))} via ${r?.servedBy ?? "?"} ${r?.durationMs ?? "?"}ms${attempts(r?.attempts)}`;
      return ok
        ? `${head} ${kind("ok", p.ok)} ${summary}`
        : `${head} ${kind("fail", p.error)} ${summary} — ${r?.outcome?.error ?? "unknown error"}`;
    }
    case "invocationStart": {
      const e = event as InvocationStartEvent;
      return `${head} ${kind("infer", p.command)} ${e.fn ?? "?"}() ${p.dim(e.file ?? "<unknown>")}`;
    }
    case "invocationEnd": {
      const t = (event as InvocationEndEvent).trace;
      return `${head} ${kind("done", p.dim)} ${t?.fn ?? "?"}() ${p.dim(t?.file ?? "<unknown>")}`;
    }
    default:
      return `${head} ${kind(envelope.kind, p.dim)}`;
  }
}
