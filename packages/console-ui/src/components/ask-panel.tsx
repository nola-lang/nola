import { Link } from "react-router";
import { cn } from "@/lib/utils";
import type { AskDetail, InvocationLink } from "../api";
import { formatClock, formatDuration } from "../format";
import { withSearch } from "../search";
import { Json } from "./json";
import { KindIcon } from "./kind-icon";
import { StatusDot } from "./status-dot";

export const LABEL = "mt-6 mb-2 font-sans font-semibold text-[11px] text-muted-foreground uppercase tracking-[0.12em]";
export const META = "col-start-2 font-mono text-[11px] text-muted-foreground";
export const ROW =
  "grid w-full grid-cols-[auto_1fr] items-center gap-x-2.5 border-b px-3.5 py-2.5 text-left text-foreground hover:bg-card focus-visible:outline-2 focus-visible:outline-ring";
export const ROW_SELECTED = "bg-card shadow-[inset_2px_0_0_var(--primary)]";

/** The owning invocation chain, root first — each name opens that invocation. */
export function Breadcrumb({ chain, search }: { chain: InvocationLink[]; search: URLSearchParams }) {
  if (chain.length === 0) return null;
  return (
    <nav className="col-span-full mb-1 flex flex-wrap items-center gap-1 font-mono text-[11px] text-muted-foreground" aria-label="Invocation chain">
      {chain.map((link, i) => (
        <span key={link.invocationId} className="flex items-center gap-1">
          {i > 0 && <span aria-hidden>›</span>}
          <Link
            to={`/traces/${encodeURIComponent(link.invocationId)}${withSearch(search, { ask: undefined })}`}
            className="hover:text-foreground hover:underline"
          >
            {link.fn ?? "<anonymous>"}(..)
          </Link>
        </span>
      ))}
    </nav>
  );
}

/** The header every ask panel opens with: breadcrumb, status, kind icon, the label, then the facts line. */
export function AskHeader({ detail, title, search }: { detail: AskDetail; title: string; search: URLSearchParams }) {
  return (
    <div className="grid grid-cols-[auto_auto_1fr] items-baseline gap-x-2.5">
      <Breadcrumb chain={detail.invocationChain} search={search} />
      <StatusDot status={detail.status} />
      <KindIcon kind={detail.kind ?? "extract"} className="self-center" />
      <h1 className="m-0 font-mono font-semibold text-base">{title}</h1>
      <span className={cn(META, "col-start-3")}>
        {detail.status} · {formatClock(detail.startedAt)} · {formatDuration(detail.durationMs)}
        {detail.provider ? ` · ${detail.provider}` : ""}
        {detail.profile ? ` · profile ${detail.profile}` : ""}
        {detail.site ? ` · ${detail.site}` : ""}
      </span>
    </div>
  );
}

/** What the ask produced: the outcome value, the error, or a note while it still runs. */
export function ResultBlock({ detail, title }: { detail: AskDetail; title: string }) {
  const outcome = detail.receipt?.outcome as { ok?: boolean; value?: unknown } | undefined;
  return (
    <section>
      <h2 className={LABEL}>{title}</h2>
      {detail.error ? (
        <p className="m-0 rounded-md border border-err px-3 py-2.5 font-mono text-err text-xs">{detail.error}</p>
      ) : outcome?.ok === true ? (
        <Json value={outcome.value} />
      ) : (
        <p className="m-0 font-mono text-muted-foreground text-xs">
          {detail.status === "running" ? "Still running." : "No value was recorded."}
        </p>
      )}
    </section>
  );
}

/** The shared tail of every ask panel: attempts, receipt, timeline. */
export function AskBody({ detail }: { detail: AskDetail }) {
  return (
    <>
      {detail.attemptRows.length > 0 && (
        <section>
          <h2 className={LABEL}>attempts</h2>
          <ol className="m-0 list-none rounded-md border p-0">
            {detail.attemptRows.map((attempt) => (
              <li
                key={attempt.attempt}
                className="flex items-baseline gap-3 border-b px-3 py-1.5 font-mono text-xs last:border-b-0"
              >
                <span className="text-muted-foreground">#{attempt.attempt}</span>
                <span>{attempt.provider ?? "—"}</span>
                <span className="text-[11px] text-muted-foreground">{formatDuration(attempt.durationMs)}</span>
                {attempt.validation === "failed" && <span className="text-err">validation failed</span>}
              </li>
            ))}
          </ol>
        </section>
      )}
      {detail.receipt && (
        <section>
          <h2 className={LABEL}>receipt</h2>
          <Json value={detail.receipt} />
        </section>
      )}
      <section>
        <h2 className={LABEL}>timeline</h2>
        <ol className="flex flex-col gap-2.5">
          {detail.events.map((row) => (
            <li key={row.seq} className="grid grid-cols-[28px_160px_1fr] items-baseline gap-x-2.5">
              <span className="text-right font-mono text-[11px] text-muted-foreground">{row.seq}</span>
              <span className="font-mono font-semibold text-xs">{row.kind}</span>
              <span className="justify-self-end font-mono text-[11px] text-muted-foreground">{formatClock(row.at)}</span>
              <Json value={row.event} className="col-span-full" />
            </li>
          ))}
        </ol>
      </section>
    </>
  );
}

/** An extract: the header IS the source (..`instruction`<T>, untruncated), then what it produced. */
export function AskPanel({ detail, search }: { detail: AskDetail; search: URLSearchParams }) {
  const source = `..\`${detail.instruction ?? ""}\`${detail.typeText ? `<${detail.typeText}>` : ""}`;
  return (
    <>
      <AskHeader detail={detail} title={source} search={search} />
      <ResultBlock detail={detail} title="result" />
      <AskBody detail={detail} />
    </>
  );
}
