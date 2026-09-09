import { Link } from "react-router";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { TraceRecord } from "../api";
import { formatDuration } from "../format";
import { FileLink, ProjectLink } from "./filter-links";
import { KindIcon } from "./kind-icon";
import { StatusDot } from "./status-dot";

const INDENT = 12;

const ROW =
  "relative grid w-full grid-cols-[auto_auto_1fr_auto] items-center gap-x-2 gap-y-0.5 border-b py-2 pr-3 text-left text-foreground hover:bg-card";
export const ROW_SELECTED = "bg-card shadow-[inset_2px_0_0_var(--primary)]";

/**
 * One record in the stream; `to` is where a click navigates. Indented by
 * depth, with a faint guide on nested rows. A root invocation also names its
 * project and file on a second line, as filter links — nested records
 * inherit them, so they stay clean. The row's navigation is an overlay link underneath the
 * parameter links (a button cannot live inside an anchor).
 */
export function RecordRow({ record, selected, to }: { record: TraceRecord; selected: boolean; to: string }) {
  const attempts =
    record.kind !== "invocation" && record.attempts !== undefined && record.attempts > 1 ? record.attempts : undefined;
  const root = record.kind === "invocation" && record.parentId === undefined ? record : undefined;
  return (
    <li
      className={cn(ROW, selected && ROW_SELECTED, record.depth > 0 && "border-l border-l-border/40")}
      style={{ paddingLeft: 14 + record.depth * INDENT }}
    >
      <Link
        to={to}
        className="absolute inset-0 focus-visible:outline-none"
        aria-label={`Open ${record.label}`}
        aria-current={selected ? "true" : undefined}
      />
      <StatusDot status={record.status} />
      <KindIcon kind={record.kind} />
      <span className="flex min-w-0 items-baseline gap-1.5 font-mono text-xs">
        <span className="truncate">{record.label}</span>
        {record.kind === "invocation" && record.parentId !== undefined && (
          <span className="shrink-0 text-[10px] text-muted-foreground">attached</span>
        )}
        {attempts !== undefined && (
          <span className="shrink-0 text-[11px] text-muted-foreground">· {attempts} attempts</span>
        )}
      </span>
      <Badge
        variant="outline"
        className={cn(
          "h-5 px-1.5 font-mono text-[11px]",
          record.status === "running" ? "text-live" : "text-muted-foreground",
        )}
      >
        {record.status === "running" ? "running" : formatDuration(record.durationMs)}
      </Badge>
      {root !== undefined && (root.project !== undefined || root.file !== undefined) && (
        <span className="col-start-3 col-end-5 flex min-w-0 items-baseline gap-1.5 font-mono text-[11px] text-muted-foreground">
          {root.project !== undefined && <ProjectLink name={root.project} className="min-w-0 truncate" />}
          {root.project !== undefined && root.file !== undefined && <span aria-hidden>·</span>}
          {root.file !== undefined && <FileLink file={root.file} className="min-w-0 truncate" />}
        </span>
      )}
    </li>
  );
}
