/**
 * The unified filter: one value object parsed from the window's search
 * params, so a filter is attached to the URL and travels between views.
 * Project narrows the server query, and so does a definition's executions
 * filter (`definitionAsksQuery` — the server caps that list, so the filter
 * has to run before the cap); everything else narrows the loaded rows
 * client-side (a local console holds little enough for that).
 * Pure functions; the bar and the views are the only callers.
 */
import { type DefinitionAsksQuery, type DefinitionSummary, groupByTrace, type InvocationRecord, type TraceRecord } from "./api";

export type ProjectName = string | null;

export interface Filter {
  /** `[]` = every project; `null` is the `(no project)` bucket */
  projects: ProjectName[];
  /** epoch ms, inclusive */
  from?: number;
  to?: number;
  /** ms, inclusive */
  dmin?: number;
  dmax?: number;
  pid?: number;
  /** case-insensitive substring of the source path */
  file?: string;
}

export type FilterParam = "project" | "time" | "duration" | "pid" | "file";

export const FILTER_PARAMS: ReadonlyArray<{ key: FilterParam; label: string; hint: string }> = [
  { key: "project", label: "project", hint: "one or more projects" },
  { key: "time", label: "time range", hint: "when it happened" },
  { key: "duration", label: "duration", hint: "min – max elapsed" },
  { key: "pid", label: "pid", hint: "one process" },
  { key: "file", label: "file", hint: "source path contains" },
];

/** URL spellings. `project` repeats; the `(no project)` bucket is spelled `(none)`. */
const KEYS = ["project", "from", "to", "dmin", "dmax", "pid", "file"] as const;
const NONE = "(none)";

/** One API query per selected project: `{}` = all projects (nothing selected). */
export type ProjectQuery = { project?: ProjectName };

export function planProjectQueries(projects: readonly ProjectName[]): ProjectQuery[] {
  return projects.length === 0 ? [{}] : projects.map((name) => ({ project: name }));
}

const num = (raw: string | null): number | undefined => {
  if (raw === null || raw.trim() === "") return undefined;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
};

export function parseFilter(search: URLSearchParams): Filter {
  const projects = [...new Set(search.getAll("project"))].map((p): ProjectName => (p === NONE ? null : p));
  const file = search.get("file")?.trim();
  return {
    projects,
    from: num(search.get("from")),
    to: num(search.get("to")),
    dmin: num(search.get("dmin")),
    dmax: num(search.get("dmax")),
    pid: num(search.get("pid")),
    ...(file ? { file } : {}),
  };
}

/** The search string for `filter`, keeping every non-filter param of `base` (e.g. `ask`). */
export function serializeFilter(filter: Filter, base: URLSearchParams): string {
  const next = new URLSearchParams(base);
  for (const key of KEYS) next.delete(key);
  for (const p of filter.projects) next.append("project", p === null ? NONE : p);
  for (const key of ["from", "to", "dmin", "dmax", "pid"] as const) {
    const v = filter[key];
    if (v !== undefined) next.set(key, String(v));
  }
  if (filter.file) next.set("file", filter.file);
  const s = next.toString();
  return s === "" ? "" : `?${s}`;
}

export const isEmptyFilter = (f: Filter): boolean =>
  f.projects.length === 0 &&
  f.from === undefined &&
  f.to === undefined &&
  f.dmin === undefined &&
  f.dmax === undefined &&
  f.pid === undefined &&
  f.file === undefined;

/** Which params are set, in bar order. */
export function activeParams(f: Filter): FilterParam[] {
  const out: FilterParam[] = [];
  if (f.projects.length > 0) out.push("project");
  if (f.from !== undefined || f.to !== undefined) out.push("time");
  if (f.dmin !== undefined || f.dmax !== undefined) out.push("duration");
  if (f.pid !== undefined) out.push("pid");
  if (f.file !== undefined) out.push("file");
  return out;
}

export function clearParam(f: Filter, param: FilterParam): Filter {
  switch (param) {
    case "project":
      return { ...f, projects: [] };
    case "time":
      return { ...f, from: undefined, to: undefined };
    case "duration":
      return { ...f, dmin: undefined, dmax: undefined };
    case "pid":
      return { ...f, pid: undefined };
    case "file": {
      const { file: _, ...rest } = f;
      return rest;
    }
  }
}

/** Add a project to the selection (a no-op when it is already in). */
export const addProject = (f: Filter, name: ProjectName): Filter =>
  f.projects.includes(name) ? f : { ...f, projects: [...f.projects, name] };

/** The whole minute an instant falls in — what a click on a row's time filters to. */
export function minuteRange(at: number): { from: number; to: number } {
  const from = Math.floor(at / 60_000) * 60_000;
  return { from, to: from + 59_999 };
}

export function toggleProject(f: Filter, name: ProjectName): Filter {
  const projects = f.projects.includes(name) ? f.projects.filter((p) => p !== name) : [...f.projects, name];
  return { ...f, projects };
}

const inTime = (f: Filter, at: number): boolean =>
  (f.from === undefined || at >= f.from) && (f.to === undefined || at <= f.to);

/** An open-ended range on both sides passes anything; a bound needs a value. */
const inDuration = (f: Filter, ms: number | undefined): boolean => {
  if (f.dmin === undefined && f.dmax === undefined) return true;
  if (ms === undefined) return false;
  return (f.dmin === undefined || ms >= f.dmin) && (f.dmax === undefined || ms <= f.dmax);
};

const inFile = (f: Filter, file: string | undefined): boolean =>
  f.file === undefined || file?.toLowerCase().includes(f.file.toLowerCase()) === true;

const inPid = (f: Filter, pid: number | undefined): boolean => f.pid === undefined || pid === f.pid;

const matchesRoot = (f: Filter, root: InvocationRecord, files: readonly string[]): boolean =>
  inTime(f, root.startedAt) &&
  inDuration(f, root.durationMs) &&
  inPid(f, root.pid) &&
  (f.file === undefined || [root.file, ...files].some((file) => inFile(f, file)));

/**
 * The records whose ROOT passes the filter — a matching root keeps its whole
 * subtree, so the tree never shows orphans. The file filter also looks at every
 * descendant ask's site, so filtering by a file finds the traces that touched it.
 */
export function visibleRecords(f: Filter, records: readonly TraceRecord[]): TraceRecord[] {
  return groupByTrace(records)
    .filter((group) => {
      const root = group[0];
      if (root?.kind !== "invocation") return false;
      const files = group.flatMap((r) => (r.kind !== "invocation" && r.site ? [r.site.split(":")[0] as string] : []));
      return matchesRoot(f, root, files);
    })
    .flat();
}

/** Definitions have a life span, not an instant: the range must overlap [firstSeen, lastSeen]; duration is the average. */
export const matchesDefinition = (f: Filter, d: DefinitionSummary): boolean =>
  (f.from === undefined || d.lastSeenAt >= f.from) &&
  (f.to === undefined || d.firstSeenAt <= f.to) &&
  inDuration(f, d.avgDurationMs) &&
  inFile(f, d.file);

/**
 * The part of the filter an execution answers to — time, duration, pid — as the server query of
 * `GET /api/definitions/:def`. Project and file belong to the definition, not to its executions.
 */
export function definitionAsksQuery(f: Filter): DefinitionAsksQuery {
  const query: DefinitionAsksQuery = {};
  for (const key of ["from", "to", "dmin", "dmax", "pid"] as const) {
    const v = f[key];
    if (v !== undefined) query[key] = v;
  }
  return query;
}

/** What the executions list holds out of what exists: `""` when it is everything. */
export function executionsCaption(n: { shown: number; matched: number; executions: number }): string {
  const truncated = n.shown < n.matched;
  const narrowed = n.matched < n.executions;
  if (truncated && narrowed) return `latest ${n.shown} of ${n.matched} matching, ${n.executions} total`;
  if (truncated) return `latest ${n.shown} of ${n.executions}`;
  if (narrowed) return `${n.matched} of ${n.executions}`;
  return "";
}
