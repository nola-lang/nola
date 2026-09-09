import type { ReactNode } from "react";
import { useSearchParams } from "react-router";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { addProject, type Filter, minuteRange, type ProjectName, parseFilter, serializeFilter } from "../filter";
import { formatClock, formatDuration } from "../format";

/** A setter that folds a change into the window's current filter. */
export function useAddFilter(): (patch: (f: Filter) => Filter) => void {
  const [search, setSearch] = useSearchParams();
  return (patch) => setSearch(new URLSearchParams(serializeFilter(patch(parseFilter(search)), search)), { replace: true });
}

const LINK =
  "relative z-10 rounded-sm hover:text-foreground hover:underline hover:underline-offset-2 focus-visible:outline-2 focus-visible:outline-ring text-nowrap";

function ParamLink({ title, onClick, className, children }: { title: string; onClick: () => void; className?: string; children: ReactNode }) {
  return (
    <button type="button" title={title} className={cn(LINK, className)} onClick={onClick}>
      {children}
    </button>
  );
}

/** Row parameters that add themselves to the filter on click. */

export function PidLink({ pid }: { pid: number }) {
  const add = useAddFilter();
  return (
    <ParamLink title={`Filter by pid ${pid}`} onClick={() => add((f) => ({ ...f, pid }))}>
      pid:{pid}
    </ParamLink>
  );
}

export function ProjectLink({ name, className }: { name: ProjectName; className?: string }) {
  const add = useAddFilter();
  const label = name ?? "(no project)";
  return (
    <ParamLink title={`Filter by project ${label}`} className={className} onClick={() => add((f) => addProject(f, name))}>
      {label}
    </ParamLink>
  );
}

export function FileLink({ file, className }: { file: string; className?: string }) {
  const add = useAddFilter();
  return (
    <ParamLink title={`Filter by file ${file}`} className={className} onClick={() => add((f) => ({ ...f, file }))}>
      {file}
    </ParamLink>
  );
}

/** The minute the instant falls in. */
export function TimeLink({ at }: { at: number }) {
  const add = useAddFilter();
  const { from, to } = minuteRange(at);
  return (
    <ParamLink
      title={`Filter to ${formatClock(from)} – ${formatClock(to)}`}
      onClick={() => add((f) => ({ ...f, from, to }))}
    >
      {formatClock(at)}
    </ParamLink>
  );
}

/** Elapsed time is a bound, not a value: the click asks which side. */
export function DurationLink({ ms, className, children }: { ms: number; className?: string; children: ReactNode }) {
  const add = useAddFilter();
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" title="Filter by duration" className={cn(LINK, className)}>
          {children}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={4} className="flex w-auto gap-1 p-1">
        <PopoverChoice onClick={() => add((f) => ({ ...f, dmax: ms }))}>≤ {formatDuration(ms)}</PopoverChoice>
        <PopoverChoice onClick={() => add((f) => ({ ...f, dmin: ms }))}>≥ {formatDuration(ms)}</PopoverChoice>
      </PopoverContent>
    </Popover>
  );
}

function PopoverChoice({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      className="rounded-sm px-2 py-1 font-mono text-xs hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
      onClick={onClick}
    >
      {children}
    </button>
  );
}
