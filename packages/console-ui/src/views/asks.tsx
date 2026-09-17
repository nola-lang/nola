import { useQuery } from "@tanstack/react-query";
import { Link, useParams, useSearchParams } from "react-router";
import { cn } from "@/lib/utils";
import { type DefinitionDetail, fetchAsk, fetchDefinition, fetchDefinitionsAcross } from "../api";

import { AskPanel, LABEL, META, ROW, ROW_SELECTED } from "../components/ask-panel";
import { CallPanel } from "../components/call-panel";
import { DurationChart } from "../components/duration-chart";
import { ExecutionsTable } from "../components/executions-table";
import { KindIcon } from "../components/kind-icon";
import { ListPane } from "../components/list-pane";
import { SplitPane } from "../components/split-pane";
import { errorTone, StatusDot } from "../components/status-dot";
import { definitionAsksQuery, executionsCaption, matchesDefinition } from "../filter";
import { formatClock } from "../format";
import { withSearch } from "../search";
import { defStatLine } from "../stat-line";
import { useFilter, useProjectQueries } from "../use-filter";
import { DETAIL, EMPTY } from "./traces";

/**
 * `/asks` and `/asks/:def` — one row per AskDefinition; `?ask=` opens one execution.
 * The URL filter narrows the definitions by project, file and life span, and a
 * definition's executions by time, duration and pid — that part runs on the server, which caps
 * the list, so an old window is reachable however many newer executions exist.
 */
export function AsksView() {
  const filter = useFilter();
  const queries = useProjectQueries();
  const { def } = useParams();
  const [search] = useSearchParams();
  const askId = search.get("ask") ?? undefined;

  const definitions = useQuery({ queryKey: ["definitions", queries], queryFn: () => fetchDefinitionsAcross(queries) }).data;
  const visible = definitions?.filter((d) => matchesDefinition(filter, d));
  const asksQuery = definitionAsksQuery(filter);
  const definition = useQuery({
    queryKey: ["definition", def, asksQuery],
    queryFn: () => fetchDefinition(def as string, asksQuery),
    enabled: def !== undefined,
    // a filter edit re-queries: keep the panel up meanwhile (never another definition's)
    placeholderData: (previous, previousQuery) => (previousQuery?.queryKey[1] === def ? previous : undefined),
  }).data;
  const askDetail = useQuery({
    queryKey: ["ask", askId],
    queryFn: () => fetchAsk(askId as string),
    enabled: askId !== undefined,
  }).data;

  return (
    <SplitPane
      master={
        <ListPane title="Asks" count={visible?.length}>
        {definitions?.length === 0 && (
          <li className={EMPTY}>No ask definitions yet — they appear when an app built with the current Nola runs an ask.</li>
        )}
        {definitions !== undefined && definitions.length > 0 && visible?.length === 0 && (
          <li className={EMPTY}>No ask definition matches the filter.</li>
        )}
        {visible?.map((d) => (
          <li key={d.def}>
            <Link
              to={`/asks/${encodeURIComponent(d.def)}${withSearch(search, { ask: undefined })}`}
              className={cn(ROW, "grid-cols-[auto_auto_1fr]", d.def === def && ROW_SELECTED)}
              aria-current={d.def === def ? "page" : undefined}
            >
              <StatusDot status={errorTone(d.errorCount)} />
              <KindIcon kind={d.kind ?? "extract"} />
              <span className="truncate font-mono text-xs">{d.instruction ?? d.def.slice(0, 8)}</span>
              <span className={cn(META, "col-start-3")}>
                {d.file ? `${d.file}${d.loc ? `:${d.loc}` : ""} · ` : ""}
                {defStatLine(d)}
              </span>
            </Link>
          </li>
        ))}
        </ListPane>
      }
    >
      <section className={DETAIL}>
        {!definition && <div className={EMPTY}>Select an ask definition to see how it behaves over time.</div>}
        {definition && <DefinitionPanel definition={definition} selectedAskId={askId} scaleKey={`${definition.def}|${JSON.stringify(asksQuery)}`} />}
        {definition && askDetail && (
          <div className="mt-7 border-t pt-4">
            {askDetail.kind === "call" ? (
              <CallPanel detail={askDetail} search={search} />
            ) : (
              <AskPanel detail={askDetail} search={search} />
            )}
          </div>
        )}
      </section>
    </SplitPane>
  );
}

function DefinitionPanel({ definition, selectedAskId, scaleKey }: { definition: DefinitionDetail; selectedAskId?: string; scaleKey: string }) {
  const { asks, matched, executions } = definition;
  const caption = executionsCaption({ shown: asks.length, matched, executions });
  const suffix = caption === "" ? "" : ` (${caption})`;
  return (
    <>
      <div className="grid grid-cols-[auto_auto_1fr] items-baseline gap-x-2.5">
        <StatusDot status={errorTone(definition.errorCount)} />
        <KindIcon kind={definition.kind ?? "extract"} className="self-center" />
        <h1 className="m-0 font-mono font-semibold text-base">{definition.instruction ?? definition.def.slice(0, 8)}</h1>
        <span className={cn(META, "col-start-3")}>
          {definition.file ? `${definition.file}${definition.loc ? `:${definition.loc}` : ""} · ` : ""}
          first seen {formatClock(definition.firstSeenAt)} · last {formatClock(definition.lastSeenAt)}
        </span>
      </div>
      <p className="mt-2 mb-0 font-mono text-muted-foreground text-xs">
        {defStatLine(definition)}
        {definition.avgAttempts !== undefined ? ` · avg attempts ${definition.avgAttempts.toFixed(1)}` : ""}
        {definition.providers.length > 0 ? ` · ${definition.providers.join(" · ")}` : ""}
        {definition.errorCount > 0 ? ` · ${definition.errorCount} error${definition.errorCount === 1 ? "" : "s"}` : ""}
      </p>
      <h2 className={LABEL}>duration per execution{suffix}</h2>
      <DurationChart asks={asks} providers={definition.providers} scaleKey={scaleKey} />
      <h2 className={LABEL}>executions{suffix}</h2>
      <ExecutionsTable asks={asks} selectedAskId={selectedAskId} />
    </>
  );
}
