import { useQuery } from "@tanstack/react-query";
import { useParams, useSearchParams } from "react-router";
import { fetchAsk, fetchRecordsAcross, fetchTrace } from "../api";
import { AskPanel } from "../components/ask-panel";
import { CallPanel } from "../components/call-panel";
import { ClearTraces } from "../components/clear-traces";
import { InvocationPanel } from "../components/invocation-panel";
import { ListPane } from "../components/list-pane";
import { RecordRow } from "../components/record-row";
import { SplitPane } from "../components/split-pane";
import { visibleRecords } from "../filter";
import { withSearch } from "../search";
import { useFilter, useProjectQueries } from "../use-filter";

export const EMPTY = "grid flex-1 place-content-center p-8 text-center text-muted-foreground";
export const DETAIL = "h-full overflow-y-auto px-6 py-5";

/**
 * `/traces` and `/traces/:invocationId`: the master pane is the records stream —
 * every invocation, extract and call as a row, indented by depth, roots newest
 * first. The detail pane depends on what is selected: an invocation shows its
 * subtree, `?ask=` shows that extract or call.
 */
export function TracesView() {
  const filter = useFilter();
  const queries = useProjectQueries();
  const { invocationId } = useParams();
  const [search] = useSearchParams();
  const askId = search.get("ask") ?? undefined;

  const records = useQuery({ queryKey: ["records", queries], queryFn: () => fetchRecordsAcross(queries) }).data;
  const visible = records === undefined ? undefined : visibleRecords(filter, records);
  const trace = useQuery({
    queryKey: ["trace", invocationId],
    queryFn: () => fetchTrace(invocationId as string),
    enabled: invocationId !== undefined,
  }).data;
  const askDetail = useQuery({
    queryKey: ["ask", askId],
    queryFn: () => fetchAsk(askId as string),
    enabled: askId !== undefined,
  }).data;

  const rootCount = visible?.filter((r) => r.depth === 0).length;
  return (
    <SplitPane
      master={
        <ListPane
          title="Traces"
          count={rootCount}
          actions={<ClearTraces disabled={records === undefined || records.length === 0} />}
        >
        {records?.length === 0 && (
          <li className={EMPTY}>
            Waiting for traces. Add <code>telemetry: nola.tracer("{location.origin}")</code> to your app's{" "}
            <code>nola.config.ts</code> and every invocation will appear here.
          </li>
        )}
        {records !== undefined && records.length > 0 && visible?.length === 0 && (
          <li className={EMPTY}>No trace matches the filter.</li>
        )}
        {visible?.map((r) => (
          <RecordRow
            key={r.id}
            record={r}
            selected={askId !== undefined ? r.id === askId : r.id === invocationId}
            to={
              r.kind === "invocation"
                ? `/traces/${encodeURIComponent(r.id)}${withSearch(search, { ask: undefined })}`
                : `/traces/${encodeURIComponent(r.parentId ?? r.traceId)}${withSearch(search, { ask: r.id })}`
            }
          />
        ))}
        </ListPane>
      }
    >
      <section className={DETAIL}>
        {!trace && !askDetail && <div className={EMPTY}>Select a record to inspect it.</div>}
        {askDetail ? (
          askDetail.kind === "call" ? (
            <CallPanel detail={askDetail} search={search} />
          ) : (
            <AskPanel detail={askDetail} search={search} />
          )
        ) : (
          trace && <InvocationPanel detail={trace} search={search} />
        )}
      </section>
    </SplitPane>
  );
}
