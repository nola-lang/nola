import type { AskKind, AskSummary, DefinitionAsksQuery, DefinitionDetail } from "./api";

/** Mirrors storage's DEFAULT_DEFINITION_ASKS_LIMIT — the patched list never outgrows what a refetch returns. */
const ASKS_CAP = 500;

type Site = { file?: string; loc?: string };
type StartEvent = {
  askId?: string;
  def?: string;
  site?: Site;
  provider?: string;
  spanPath?: readonly string[];
  instruction?: string;
  kind?: string;
  callee?: string;
  hint?: string;
  typeText?: string;
};
type EndEvent = {
  askId?: string;
  receipt?: {
    def?: string;
    site?: Site;
    servedBy?: string;
    profile?: string;
    attempts?: number;
    durationMs?: number;
    outcome?: { ok?: boolean; error?: string };
    spanPath?: readonly string[];
    kind?: string;
  };
};
type Envelope = { kind?: unknown; at?: unknown; pid?: unknown; runId?: unknown; event?: unknown };

const siteText = (site?: Site): string | undefined => (site?.file && site.loc ? `${site.file}:${site.loc}` : undefined);
const askKind = (raw: string | undefined): AskKind | undefined => (raw === undefined ? undefined : raw === "call" ? "call" : "extract");
const traceIdOf = (spanPath: readonly string[] | undefined, runId: unknown): string => spanPath?.[0] ?? `run:${String(runId)}`;

/** Drop undefined members so a patched row equals the row a refetch returns. */
function compact<T extends object>(row: T): T {
  return Object.fromEntries(Object.entries(row).filter(([, value]) => value !== undefined)) as T;
}

/** Storage's executions filter: a NULL duration fails every duration bound. */
function passes(ask: AskSummary, query: DefinitionAsksQuery): boolean {
  if (query.from !== undefined && ask.startedAt < query.from) return false;
  if (query.to !== undefined && ask.startedAt > query.to) return false;
  if (query.pid !== undefined && ask.pid !== query.pid) return false;
  if (query.dmin !== undefined && !(ask.durationMs !== undefined && ask.durationMs >= query.dmin)) return false;
  if (query.dmax !== undefined && !(ask.durationMs !== undefined && ask.durationMs <= query.dmax)) return false;
  return true;
}

function sameAsk(a: AskSummary, b: AskSummary): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]) as Set<keyof AskSummary>;
  for (const key of keys) if (a[key] !== b[key]) return false;
  return true;
}

/** Newest first, the order storage returns; stable for equal starts. */
function insert(asks: readonly AskSummary[], row: AskSummary): AskSummary[] {
  const at = asks.findIndex((a) => a.startedAt <= row.startedAt);
  const next = [...asks];
  next.splice(at === -1 ? next.length : at, 0, row);
  return next.length > ASKS_CAP ? next.slice(0, ASKS_CAP) : next;
}

/**
 * Apply one live notice (an ingest envelope off the event stream) to a
 * cached definition, the way storage applies it to the database — so the
 * execution shows up the moment it starts and settles the moment it ends,
 * without waiting for a refetch. A refetch still follows and is the truth:
 * this only has to agree with it for what is SHOWN. It therefore touches
 * the counters only for an execution it shows, which also makes it
 * idempotent — re-applying a notice over refetched data returns the SAME
 * object, and so does any notice that is not this definition's.
 */
export function applyNotice(detail: DefinitionDetail, query: DefinitionAsksQuery, notice: unknown): DefinitionDetail {
  if (notice === null || typeof notice !== "object") return detail;
  const envelope = notice as Envelope;
  if (typeof envelope.at !== "number") return detail;
  const at = envelope.at;
  const pid = typeof envelope.pid === "number" ? envelope.pid : undefined;

  if (envelope.kind === "askStart") {
    const e = (envelope.event ?? {}) as StartEvent;
    if (typeof e.askId !== "string" || e.def !== detail.def) return detail;
    if (detail.asks.some((a) => a.askId === e.askId)) return detail; // already shown — never downgrade a settled one
    const row = compact<AskSummary>({
      askId: e.askId,
      traceId: traceIdOf(e.spanPath, envelope.runId),
      pid,
      def: e.def,
      kind: askKind(e.kind),
      site: siteText(e.site),
      instruction: e.instruction,
      callee: e.callee,
      hint: e.hint,
      typeText: e.typeText,
      provider: e.provider,
      status: "running",
      startedAt: at,
    });
    if (!passes(row, query)) return detail;
    return {
      ...detail,
      asks: insert(detail.asks, row),
      executions: detail.executions + 1,
      matched: detail.matched + 1,
      lastSeenAt: Math.max(detail.lastSeenAt, at),
    };
  }

  if (envelope.kind === "askEnd") {
    const e = (envelope.event ?? {}) as EndEvent;
    const r = e.receipt ?? {};
    if (typeof e.askId !== "string") return detail;
    const shown = detail.asks.find((a) => a.askId === e.askId);
    if (shown === undefined && r.def !== detail.def) return detail;
    const failed = r.outcome?.ok !== true;
    const provider = r.servedBy ?? shown?.provider;
    const settled = compact<AskSummary>({
      ...(shown ?? { askId: e.askId, traceId: traceIdOf(r.spanPath, envelope.runId), pid, def: r.def, kind: askKind(r.kind), site: siteText(r.site), startedAt: at }),
      provider,
      profile: r.profile ?? shown?.profile,
      status: failed ? "error" : "ok",
      durationMs: r.durationMs,
      attempts: r.attempts,
      error: failed ? (r.outcome?.error ?? "unknown error") : undefined,
    });
    if (shown !== undefined && sameAsk(shown, settled)) return detail;

    const keep = passes(settled, query);
    const newlySettled = shown === undefined || shown.status === "running";
    const others = detail.asks.filter((a) => a.askId !== e.askId);
    const providers =
      provider !== undefined && !detail.providers.includes(provider) ? [...detail.providers, provider].sort() : detail.providers;
    if (shown === undefined && !keep) return detail;
    return {
      ...detail,
      asks: keep ? insert(others, settled) : others,
      providers,
      executions: detail.executions + (shown === undefined ? 1 : 0),
      matched: detail.matched + (shown === undefined ? 1 : keep ? 0 : -1),
      okCount: detail.okCount + (newlySettled && !failed ? 1 : 0),
      errorCount: detail.errorCount + (newlySettled && failed ? 1 : 0),
      lastSeenAt: Math.max(detail.lastSeenAt, at),
    };
  }

  return detail;
}
