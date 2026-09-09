import type { ProjectQuery } from "./filter";
import type { AskStatus } from "./format";

/** `name: null` is the `(no project)` bucket for project-less apps. */
export interface ProjectSummary {
  name: string | null;
  firstSeenAt: number;
  lastSeenAt: number;
  traceCount: number;
}

export type AskKind = "extract" | "call";
export type RecordKind = "invocation" | AskKind;

/** Shared by every record in the flattened tree: one row per invocation, extract or call. */
export interface RecordBase {
  /** invocationId for an invocation, askId for an ask */
  id: string;
  kind: RecordKind;
  /** the root invocation's id */
  traceId: string;
  /** absent on a root invocation */
  parentId?: string;
  depth: number;
  /** display label built server-side — never identity */
  label: string;
  status: AskStatus;
  startedAt: number;
  durationMs?: number;
}

/** One infer-function call — a root (opened its own frame) or attached (called by a parent invocation). */
export interface InvocationRecord extends RecordBase {
  kind: "invocation";
  fn?: string;
  file?: string;
  detached: boolean;
  project?: string;
  runId: string;
  pid: number;
  completedAt?: number;
  /** over the subtree */
  askCount: number;
  errorCount: number;
}

/** One ask execution — the extract or call as its askStart/askEnd described it. */
export interface AskRecord extends RecordBase {
  kind: AskKind;
  site?: string;
  def?: string;
  instruction?: string;
  callee?: string;
  hint?: string;
  typeText?: string;
  provider?: string;
  profile?: string;
  attempts?: number;
  error?: string;
}

export type TraceRecord = InvocationRecord | AskRecord;

/** The subtree of one invocation: the node itself first, then every descendant in display order. */
export interface TraceDetail {
  node: InvocationRecord;
  records: TraceRecord[];
  /** the invocationEnd span tree, verbatim, once a ROOT completed */
  trace?: unknown;
}

export interface AttemptSummary {
  attempt: number;
  provider?: string;
  at: number;
  durationMs?: number;
  validation?: "failed";
}

export interface AskSummary {
  askId: string;
  traceId: string;
  /** the trace's process id — a filter attribute of the execution */
  pid?: number;
  def?: string;
  kind?: AskKind;
  site?: string;
  instruction?: string;
  callee?: string;
  hint?: string;
  typeText?: string;
  provider?: string;
  profile?: string;
  status: AskStatus;
  startedAt: number;
  durationMs?: number;
  attempts?: number;
  error?: string;
}

export interface AskEventRow {
  seq: number;
  at: number;
  kind: string;
  event: unknown;
}

/** One link of the owning invocation chain, root first. */
export interface InvocationLink {
  invocationId: string;
  fn?: string;
  depth: number;
}

export interface AskDetail extends AskSummary {
  attemptRows: AttemptSummary[];
  receipt?: Record<string, unknown>;
  events: AskEventRow[];
  invocationChain: InvocationLink[];
}

export async function fetchProjects(): Promise<ProjectSummary[]> {
  return ((await (await fetch("/api/projects")).json()) as { projects: ProjectSummary[] }).projects;
}

/** `project: null` selects the `(no project)` bucket; undefined = all projects. */
export async function fetchRecords(q: { project?: string | null; runId?: string } = {}): Promise<TraceRecord[]> {
  const params = new URLSearchParams();
  if (q.project === null) params.set("noProject", "1");
  else if (q.project !== undefined) params.set("project", q.project);
  if (q.runId) params.set("runId", q.runId);
  const qs = params.size > 0 ? `?${params}` : "";
  return ((await (await fetch(`/api/records${qs}`)).json()) as { records: TraceRecord[] }).records;
}

/** Wipe the console's store — every trace, ask and definition. The SSE `cleared` notice makes every open UI refetch. */
export async function clearRecords(): Promise<void> {
  const res = await fetch("/api/records", { method: "DELETE" });
  if (!res.ok) throw new Error(`clear failed: ${res.status}`);
}

export async function fetchTrace(invocationId: string): Promise<TraceDetail | undefined> {
  const res = await fetch(`/api/traces/${encodeURIComponent(invocationId)}`);
  return res.ok ? ((await res.json()) as TraceDetail) : undefined;
}

export async function fetchAsk(askId: string): Promise<AskDetail | undefined> {
  const res = await fetch(`/api/asks/${encodeURIComponent(askId)}`);
  return res.ok ? ((await res.json()) as AskDetail) : undefined;
}

/** One AskDefinition — the authored ask construct, with stats computed over its executions. */
export interface DefinitionSummary {
  def: string;
  project?: string;
  kind?: AskKind;
  file?: string;
  loc?: string;
  instruction?: string;
  firstSeenAt: number;
  lastSeenAt: number;
  executions: number;
  okCount: number;
  errorCount: number;
  avgDurationMs?: number;
  p95DurationMs?: number;
  avgAttempts?: number;
  providers: string[];
}

export interface DefinitionDetail extends DefinitionSummary {
  asks: AskSummary[];
}

/** `project: null` selects the `(no project)` bucket; undefined = all projects. */
export async function fetchDefinitions(q: { project?: string | null } = {}): Promise<DefinitionSummary[]> {
  const params = new URLSearchParams();
  if (q.project === null) params.set("noProject", "1");
  else if (q.project !== undefined) params.set("project", q.project);
  const qs = params.size > 0 ? `?${params}` : "";
  return ((await (await fetch(`/api/definitions${qs}`)).json()) as { definitions: DefinitionSummary[] }).definitions;
}

export async function fetchDefinition(def: string): Promise<DefinitionDetail | undefined> {
  const res = await fetch(`/api/definitions/${encodeURIComponent(def)}`);
  return res.ok ? ((await res.json()) as DefinitionDetail) : undefined;
}

/** Live updates: any ingested envelope means "something changed" — the app refetches (debounced). */
export function subscribe(onChange: () => void): () => void {
  const source = new EventSource("/api/events");
  source.onmessage = onChange;
  return () => source.close();
}

/** Records grouped by root, in stream order — the unit filters and merges work on. */
export function groupByTrace(records: readonly TraceRecord[]): TraceRecord[][] {
  const groups: TraceRecord[][] = [];
  let current: TraceRecord[] | undefined;
  for (const r of records) {
    if (r.depth === 0 || current === undefined) {
      current = [];
      groups.push(current);
    }
    current.push(r);
  }
  return groups;
}

/** Fan the project selection out (one request per query) and merge groups newest-first by their root, deduped by trace id. */
export async function fetchRecordsAcross(queries: readonly ProjectQuery[], runId?: string): Promise<TraceRecord[]> {
  const lists = await Promise.all(queries.map((q) => fetchRecords({ ...q, ...(runId ? { runId } : {}) })));
  const seen = new Map<string, TraceRecord[]>();
  for (const group of lists.flatMap(groupByTrace)) {
    const id = group[0]?.traceId;
    if (id !== undefined && !seen.has(id)) seen.set(id, group);
  }
  return [...seen.values()].sort((a, b) => (b[0]?.startedAt ?? 0) - (a[0]?.startedAt ?? 0)).flat();
}

export async function fetchDefinitionsAcross(queries: readonly ProjectQuery[]): Promise<DefinitionSummary[]> {
  const lists = await Promise.all(queries.map((q) => fetchDefinitions(q)));
  const seen = new Map<string, DefinitionSummary>();
  for (const item of lists.flat()) if (!seen.has(item.def)) seen.set(item.def, item);
  return [...seen.values()].sort((a, b) => b.lastSeenAt - a.lastSeenAt);
}
