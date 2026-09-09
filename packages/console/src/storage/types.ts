import type { AskKind, NolaIngestEnvelope, NolaIngestKind } from "@nola-lang/core";

/**
 * One project — keyed by the config `project` name riding the envelopes
 * (tracing model spec §1: the config string IS the identity; no minted ids).
 * `name: null` is the `(no project)` bucket for project-less envelopes.
 */
export interface ProjectSummary {
  name: string | null;
  firstSeenAt: number;
  lastSeenAt: number;
  traceCount: number;
}

export type RecordKind = "invocation" | AskKind;

/** Shared by every record in the flattened tree (records-view spec §5). */
export interface RecordBase {
  /** invocationId for an invocation, askId for an ask */
  id: string;
  kind: RecordKind;
  /** the root invocation's id */
  traceId: string;
  /** absent on a root invocation */
  parentId?: string;
  depth: number;
  /** display label built server-side (labels.ts) — never identity */
  label: string;
  status: "running" | "ok" | "error";
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
  /** the invocationEnd span tree (InvocationTrace), verbatim, once a ROOT completed */
  trace?: unknown;
}

/** One provider round trip, materialized from providerRequest/providerResponse pairs. */
export interface AttemptSummary {
  attempt: number;
  provider?: string;
  at: number;
  durationMs?: number;
  /** 'failed' when a validationFailed event named this attempt; the final attempt of an ok ask implicitly passed */
  validation?: "failed";
}

/** One ask as a definition's execution list shows it — assembled from askStart/askEnd events. */
export interface AskSummary {
  askId: string;
  /** the root invocation the ask belongs to (`spanPath[0]`, or the synthetic `run:<runId>` fallback) */
  traceId: string;
  /** the trace's process id — a filter attribute of the execution */
  pid?: number;
  /** compiler-stamped source identity — groups executions of the same authored ask */
  def?: string;
  /** what the ask executed; legacy rows without one read as extract */
  kind?: AskKind;
  /** "file:line:col" display text from the ask's Site. */
  site?: string;
  instruction?: string;
  callee?: string;
  hint?: string;
  typeText?: string;
  provider?: string;
  profile?: string;
  status: "running" | "ok" | "error";
  startedAt: number;
  durationMs?: number;
  attempts?: number;
  error?: string;
}

/** One stored hook event belonging to an ask, ordered by the sender's seq. */
export interface AskEventRow {
  seq: number;
  at: number;
  kind: NolaIngestKind;
  event: unknown;
}

/** One link of the owning invocation chain, root first. */
export interface InvocationLink {
  invocationId: string;
  fn?: string;
  depth: number;
}

/** The ask-detail view: the summary plus attempts, the receipt, every event, and the owning chain. */
export interface AskDetail extends AskSummary {
  attemptRows: AttemptSummary[];
  receipt?: unknown;
  events: AskEventRow[];
  invocationChain: InvocationLink[];
}

/**
 * One AskDefinition — the static ask construct in source, identified by the
 * compiler-stamped `def` hash (AskDefinition spec §2). Stats are computed by
 * query over the asks, never stored.
 */
export interface DefinitionSummary {
  def: string;
  project?: string;
  /** last-seen kind */
  kind?: AskKind;
  file?: string;
  /** last-seen "line:col" — display only; the identity excludes positions */
  loc?: string;
  /** last-seen instruction label */
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

/** The definition drill-down: the stats plus recent executions (newest first). */
export interface DefinitionDetail extends DefinitionSummary {
  asks: AskSummary[];
}

export interface RecordsQuery {
  project?: string;
  noProject?: boolean;
  runId?: string;
  /** counts ROOTS; every returned root's subtree is complete */
  limit?: number;
}

/** Replaceable persistence seam (console design §13) — SQLite locally, others later. */
export interface ConsoleStorage {
  ingest(envelope: NolaIngestEnvelope): Promise<void>;
  listProjects(): Promise<ProjectSummary[]>;
  /** the flattened tree in display order: roots newest first, children in start order beneath each */
  listRecords(query?: RecordsQuery): Promise<TraceRecord[]>;
  getTrace(invocationId: string): Promise<TraceDetail | undefined>;
  getAsk(askId: string): Promise<AskDetail | undefined>;
  listDefinitions(query?: { project?: string; noProject?: boolean }): Promise<DefinitionSummary[]>;
  getDefinition(def: string): Promise<DefinitionDetail | undefined>;
  /** Delete everything — every project, invocation, ask, definition, attempt and event. */
  clear(): Promise<void>;
  close(): Promise<void>;
}
