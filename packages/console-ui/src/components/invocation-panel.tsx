import { Link } from "react-router";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { TraceDetail } from "../api";
import { formatDuration } from "../format";
import { withSearch } from "../search";
import { LABEL, META } from "./ask-panel";
import { FileLink, PidLink, ProjectLink } from "./filter-links";
import { Json } from "./json";
import { KindIcon } from "./kind-icon";
import { RecordRow } from "./record-row";
import { StatusDot } from "./status-dot";

/** A root or attached invocation: header, machine chips, then every descendant record in order. */
export function InvocationPanel({
  detail,
  search,
  selectedAskId,
}: {
  detail: TraceDetail;
  search: URLSearchParams;
  selectedAskId?: string;
}) {
  const { node } = detail;
  const role = node.parentId === undefined ? (node.detached ? "detached root" : "root") : "attached";
  return (
    <>
      <div className="grid grid-cols-[auto_auto_1fr] items-baseline gap-x-2.5">
        <StatusDot status={node.status} />
        <KindIcon kind="invocation" className="self-center" />
        <h1 className="m-0 flex items-center gap-2 font-mono font-semibold text-base">
          {node.label}
          <Badge variant="outline" className="h-5 px-1.5 font-mono font-normal text-[11px] text-muted-foreground">
            {role}
          </Badge>
        </h1>
        <span className={cn(META, "col-start-3 flex flex-wrap items-center gap-x-1.5")}>
          <span>
            {node.status} · {formatDuration(node.durationMs)} · run {node.runId.slice(0, 8)} ·
          </span>
          <PidLink pid={node.pid} />
          {node.project !== undefined && (
            <>
              <span>·</span>
              <ProjectLink name={node.project} />
            </>
          )}
          {node.file !== undefined && (
            <>
              <span>·</span>
              <FileLink file={node.file} />
            </>
          )}
        </span>
      </div>
      <h2 className={LABEL}>
        inside · {node.askCount} ask{node.askCount === 1 ? "" : "s"}
        {node.errorCount > 0 ? ` · ${node.errorCount} error${node.errorCount === 1 ? "" : "s"}` : ""}
      </h2>
      {detail.records.length > 1 ? (
        <ol className="m-0 list-none overflow-hidden rounded-md border p-0 [&>li:last-child]:border-b-0">
          {detail.records.slice(1).map((r) => (
            <RecordRow
              key={r.id}
              record={{ ...r, depth: r.depth - node.depth - 1 }}
              selected={r.id === selectedAskId}
              to={
                r.kind === "invocation"
                  ? `/traces/${encodeURIComponent(r.id)}${withSearch(search, { ask: undefined })}`
                  : `/traces/${encodeURIComponent(node.id)}${withSearch(search, { ask: r.id === selectedAskId ? undefined : r.id })}`
              }
            />
          ))}
        </ol>
      ) : (
        <p className="m-0 font-mono text-muted-foreground text-xs">
          {node.status === "running" ? "Nothing yet — the function is still running." : "No asks ran inside this invocation."}
        </p>
      )}
      {detail.trace !== undefined && (
        <details className="mt-6">
          <summary className={cn(LABEL, "mt-0 cursor-pointer")}>span tree</summary>
          <Json value={detail.trace} />
        </details>
      )}
      {node.parentId !== undefined && (
        <p className={cn(META, "col-start-1 mt-4")}>
          <Link
            to={`/traces/${encodeURIComponent(node.traceId)}${withSearch(search, { ask: undefined })}`}
            className="hover:text-foreground hover:underline"
          >
            ↑ open the root trace
          </Link>
        </p>
      )}
    </>
  );
}
