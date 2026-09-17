import { rmSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import type { AskKind, NolaIngestEnvelope, NolaIngestKind } from "@nola-lang/core";
import { askLabel, invocationLabel } from "../core/labels.js";
import {
  type AskDetail,
  type AskRecord,
  type AskSummary,
  type AttemptSummary,
  type ConsoleStorage,
  DEFAULT_DEFINITION_ASKS_LIMIT,
  type DefinitionAsksQuery,
  type DefinitionDetail,
  type DefinitionSummary,
  type InvocationLink,
  type InvocationRecord,
  type ProjectSummary,
  type RecordsQuery,
  type TraceDetail,
  type TraceRecord,
} from "./types.js";

/**
 * Pre-release rule (tracing model spec §1): no migration chain — one schema
 * stamped with SCHEMA_VERSION; a db carrying any other non-zero stamp is
 * deleted and recreated. Bump the stamp on every pre-release schema rewrite;
 * the migration-runner pattern returns at first release.
 */
const SCHEMA_VERSION = 7;

const SCHEMA = `
  CREATE TABLE projects (
    name TEXT PRIMARY KEY,
    first_seen_at INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL
  );
  CREATE TABLE invocations (
    invocation_id TEXT PRIMARY KEY,
    trace_id TEXT NOT NULL,
    parent_id TEXT,
    depth INTEGER NOT NULL,
    detached INTEGER NOT NULL DEFAULT 0,
    project TEXT,
    run_id TEXT NOT NULL,
    pid INTEGER NOT NULL,
    status TEXT NOT NULL,
    fn TEXT,
    file TEXT,
    started_at INTEGER NOT NULL,
    completed_at INTEGER,
    duration_ms INTEGER,
    trace_json TEXT
  );
  CREATE INDEX invocations_trace ON invocations (trace_id, started_at);
  CREATE INDEX invocations_project ON invocations (project, started_at);
  CREATE INDEX invocations_run ON invocations (run_id);
  CREATE TABLE asks (
    ask_id TEXT PRIMARY KEY,
    trace_id TEXT NOT NULL,
    invocation_id TEXT NOT NULL,
    def TEXT,
    kind TEXT,
    site TEXT,
    instruction TEXT,
    callee TEXT,
    hint TEXT,
    type_text TEXT,
    provider TEXT,
    profile TEXT,
    status TEXT NOT NULL,
    started_at INTEGER NOT NULL,
    duration_ms INTEGER,
    attempts INTEGER,
    outcome_error TEXT,
    fingerprint TEXT,
    receipt_json TEXT
  );
  CREATE INDEX asks_trace ON asks (trace_id, started_at);
  CREATE INDEX asks_invocation ON asks (invocation_id, started_at);
  CREATE INDEX asks_def ON asks (def, started_at);
  CREATE TABLE definitions (
    def TEXT PRIMARY KEY,
    project TEXT,
    kind TEXT,
    file TEXT,
    loc TEXT,
    instruction TEXT,
    first_seen_at INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL
  );
  CREATE TABLE attempts (
    ask_id TEXT NOT NULL,
    attempt INTEGER NOT NULL,
    provider TEXT,
    at INTEGER NOT NULL,
    duration_ms INTEGER,
    validation TEXT,
    PRIMARY KEY (ask_id, attempt)
  );
  CREATE TABLE events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id TEXT NOT NULL,
    seq INTEGER NOT NULL,
    at INTEGER NOT NULL,
    kind TEXT NOT NULL,
    ask_id TEXT,
    event_json TEXT NOT NULL,
    UNIQUE (run_id, seq)
  );
  CREATE INDEX events_ask ON events (ask_id);
`;

function open(path: string): DatabaseSync {
  let db = new DatabaseSync(path);
  const stamp = (): number => (db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version;
  if (stamp() !== 0 && stamp() !== SCHEMA_VERSION) {
    db.close();
    for (const f of [path, `${path}-wal`, `${path}-shm`]) rmSync(f, { force: true });
    db = new DatabaseSync(path);
  }
  db.exec("PRAGMA journal_mode = WAL");
  if (stamp() === 0) {
    db.exec("BEGIN");
    db.exec(SCHEMA);
    db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
    db.exec("COMMIT");
  }
  return db;
}

/** Shapes the reducer reads out of the (untyped) wire events. */
type SiteShape = { file?: string; loc?: string };
type StartEvent = {
  askId?: string;
  site?: SiteShape;
  provider?: string;
  invocationId?: string;
  spanPath?: readonly string[];
  def?: string;
  instruction?: string;
  kind?: string;
  callee?: string;
  hint?: string;
  typeText?: string;
};
type AttemptEvent = { askId?: string; attempt?: number; provider?: string; durationMs?: number };
type EndEvent = {
  askId?: string;
  receipt?: {
    site?: SiteShape;
    servedBy?: string;
    profile?: string;
    attempts?: number;
    durationMs?: number;
    outcome?: { ok?: boolean; error?: string };
    fingerprint?: string;
    invocationId?: string;
    spanPath?: readonly string[];
    def?: string;
    kind?: string;
  };
};
type InvocationStartEvent = {
  invocationId?: string;
  parentInvocationId?: string;
  spanPath?: readonly string[];
  fn?: string;
  file?: string;
  detached?: boolean;
};
type InvocationEndEvent = {
  invocationId?: string;
  parentInvocationId?: string;
  status?: string;
  durationMs?: number;
  trace?: { fn?: string; file?: string };
};

const siteText = (site?: SiteShape): string | null => (site?.file && site.loc ? `${site.file}:${site.loc}` : null);
const askKind = (raw: string | null | undefined): AskKind => (raw === "call" ? "call" : "extract");

/** Every invocation on a path, root first: `[id, parentId | null, depth]`. */
function pathRows(spanPath: readonly string[]): Array<[string, string | null, number]> {
  return spanPath.map((id, i) => [id, i === 0 ? null : (spanPath[i - 1] as string), i]);
}

/** The subtree rooted at ?1 (inclusive) — every reader that aggregates over descendants starts here. */
const SUBTREE = `WITH RECURSIVE sub(id) AS (
  SELECT ? UNION ALL SELECT i.invocation_id FROM invocations i JOIN sub ON i.parent_id = sub.id
)`;

/** Local trace store over node:sqlite. All reduction is SQL upserts, so event arrival order does not matter. */
export class SqliteConsoleStorage implements ConsoleStorage {
  readonly #db: DatabaseSync;

  constructor(path: string) {
    this.#db = open(path);
  }

  /**
   * Upsert one invocation row WITHOUT touching status/completion — a placeholder
   * for ids learned from an ask's spanPath (older runtime, foreign sender) and
   * the started_at floor for every event that names the frame.
   */
  #touchInvocation(
    id: string,
    traceId: string,
    parentId: string | null,
    depth: number,
    envelope: NolaIngestEnvelope,
  ): void {
    this.#db
      .prepare(
        `INSERT INTO invocations (invocation_id, trace_id, parent_id, depth, project, run_id, pid, status, started_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'running', ?)
         ON CONFLICT (invocation_id) DO UPDATE SET
           parent_id = COALESCE(invocations.parent_id, excluded.parent_id),
           project = COALESCE(excluded.project, invocations.project),
           started_at = MIN(invocations.started_at, excluded.started_at)`,
      )
      .run(id, traceId, parentId, depth, envelope.project ?? null, envelope.runId, envelope.pid, envelope.at);
  }

  /** Every frame on a spanPath gets a row; a spanPath-less ask lands under the synthetic `run:<runId>` root. */
  #touchPath(
    spanPath: readonly string[] | undefined,
    envelope: NolaIngestEnvelope,
  ): { traceId: string; invocationId: string } {
    const path = spanPath && spanPath.length > 0 ? spanPath : [`run:${envelope.runId}`];
    const traceId = path[0] as string;
    for (const [id, parent, depth] of pathRows(path)) this.#touchInvocation(id, traceId, parent, depth, envelope);
    return { traceId, invocationId: path[path.length - 1] as string };
  }

  /** Mark every COMPLETED ancestor (inclusive) of an invocation as errored — the late-error flip. */
  #flipAncestors(invocationId: string): void {
    this.#db
      .prepare(
        `WITH RECURSIVE up(id) AS (
           SELECT ? UNION ALL SELECT i.parent_id FROM invocations i JOIN up ON i.invocation_id = up.id WHERE i.parent_id IS NOT NULL
         )
         UPDATE invocations SET status = 'error' WHERE completed_at IS NOT NULL AND invocation_id IN (SELECT id FROM up)`,
      )
      .run(invocationId);
  }

  /** Whether any ask, or any invocation strictly inside the subtree, has errored. */
  #subtreeErrored(invocationId: string): boolean {
    const row = this.#db
      .prepare(
        `${SUBTREE}
         SELECT EXISTS (SELECT 1 FROM asks WHERE invocation_id IN (SELECT id FROM sub) AND status = 'error')
             OR EXISTS (SELECT 1 FROM invocations WHERE invocation_id IN (SELECT id FROM sub) AND invocation_id != ? AND status = 'error') AS errored`,
      )
      .get(invocationId, invocationId) as { errored: number };
    return row.errored === 1;
  }

  async ingest(envelope: NolaIngestEnvelope): Promise<void> {
    if (envelope.project !== undefined) {
      this.#db
        .prepare(
          `INSERT INTO projects (name, first_seen_at, last_seen_at) VALUES (?, ?, ?)
           ON CONFLICT (name) DO UPDATE SET
             first_seen_at = MIN(projects.first_seen_at, excluded.first_seen_at),
             last_seen_at = MAX(projects.last_seen_at, excluded.last_seen_at)`,
        )
        .run(envelope.project, envelope.at, envelope.at);
    }
    const askId = (envelope.event as { askId?: string } | null)?.askId ?? null;
    const inserted = this.#db
      .prepare("INSERT OR IGNORE INTO events (run_id, seq, at, kind, ask_id, event_json) VALUES (?, ?, ?, ?, ?, ?)")
      .run(envelope.runId, envelope.seq, envelope.at, envelope.kind, askId, JSON.stringify(envelope.event ?? null));
    if (inserted.changes === 0) return; // duplicate delivery

    if (envelope.kind === "invocationStart") {
      const e = envelope.event as InvocationStartEvent;
      if (typeof e.invocationId !== "string") return;
      const path = e.spanPath && e.spanPath.length > 0 ? e.spanPath : [e.invocationId];
      const { traceId } = this.#touchPath(path, envelope);
      this.#db
        .prepare(
          `UPDATE invocations SET
             parent_id = COALESCE(?, parent_id),
             depth = ?,
             detached = ?,
             fn = COALESCE(?, fn),
             file = COALESCE(?, file),
             trace_id = ?
           WHERE invocation_id = ?`,
        )
        .run(
          e.parentInvocationId ?? null,
          path.length - 1,
          e.detached ? 1 : 0,
          e.fn ?? null,
          e.file ?? null,
          traceId,
          e.invocationId,
        );
    } else if (envelope.kind === "askStart" && askId) {
      const e = envelope.event as StartEvent;
      const { traceId, invocationId } = this.#touchPath(e.spanPath, envelope);
      this.#db
        .prepare(
          `INSERT INTO asks (ask_id, trace_id, invocation_id, def, kind, site, instruction, callee, hint, type_text, provider, status, started_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'running', ?)
           ON CONFLICT (ask_id) DO UPDATE SET
             trace_id = excluded.trace_id,
             invocation_id = excluded.invocation_id,
             def = COALESCE(excluded.def, asks.def),
             kind = COALESCE(excluded.kind, asks.kind),
             site = COALESCE(excluded.site, asks.site),
             instruction = COALESCE(excluded.instruction, asks.instruction),
             callee = COALESCE(excluded.callee, asks.callee),
             hint = COALESCE(excluded.hint, asks.hint),
             type_text = COALESCE(excluded.type_text, asks.type_text),
             provider = COALESCE(excluded.provider, asks.provider),
             started_at = MIN(asks.started_at, excluded.started_at)`,
        )
        .run(
          askId,
          traceId,
          e.invocationId ?? invocationId,
          e.def ?? null,
          e.kind ?? null,
          siteText(e.site),
          e.instruction ?? null,
          e.callee ?? null,
          e.hint ?? null,
          e.typeText ?? null,
          e.provider ?? null,
          envelope.at,
        );
      if (e.def) {
        this.#db
          .prepare(
            `INSERT INTO definitions (def, project, kind, file, loc, instruction, first_seen_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT (def) DO UPDATE SET
               project = COALESCE(excluded.project, definitions.project),
               kind = COALESCE(excluded.kind, definitions.kind),
               file = COALESCE(excluded.file, definitions.file),
               loc = COALESCE(excluded.loc, definitions.loc),
               instruction = COALESCE(excluded.instruction, definitions.instruction),
               first_seen_at = MIN(definitions.first_seen_at, excluded.first_seen_at),
               last_seen_at = MAX(definitions.last_seen_at, excluded.last_seen_at)`,
          )
          .run(
            e.def,
            envelope.project ?? null,
            e.kind ?? null,
            e.site?.file ?? null,
            e.site?.loc ?? null,
            e.instruction ?? null,
            envelope.at,
            envelope.at,
          );
      }
    } else if (envelope.kind === "providerRequest" && askId) {
      const e = envelope.event as AttemptEvent;
      if (typeof e.attempt === "number") {
        this.#db
          .prepare(
            `INSERT INTO attempts (ask_id, attempt, provider, at) VALUES (?, ?, ?, ?)
             ON CONFLICT (ask_id, attempt) DO UPDATE SET
               provider = COALESCE(excluded.provider, attempts.provider),
               at = MIN(attempts.at, excluded.at)`,
          )
          .run(askId, e.attempt, e.provider ?? null, envelope.at);
      }
    } else if (envelope.kind === "providerResponse" && askId) {
      const e = envelope.event as AttemptEvent;
      if (typeof e.attempt === "number") {
        this.#db
          .prepare(
            `INSERT INTO attempts (ask_id, attempt, provider, at, duration_ms) VALUES (?, ?, ?, ?, ?)
             ON CONFLICT (ask_id, attempt) DO UPDATE SET
               provider = COALESCE(excluded.provider, attempts.provider),
               duration_ms = COALESCE(excluded.duration_ms, attempts.duration_ms)`,
          )
          .run(askId, e.attempt, e.provider ?? null, envelope.at, e.durationMs ?? null);
      }
    } else if (envelope.kind === "validationFailed" && askId) {
      const e = envelope.event as AttemptEvent;
      if (typeof e.attempt === "number") {
        this.#db
          .prepare(
            `INSERT INTO attempts (ask_id, attempt, at, validation) VALUES (?, ?, ?, 'failed')
             ON CONFLICT (ask_id, attempt) DO UPDATE SET validation = 'failed'`,
          )
          .run(askId, e.attempt, envelope.at);
      }
    } else if (envelope.kind === "askEnd" && askId) {
      const r = (envelope.event as EndEvent).receipt ?? {};
      const { traceId, invocationId } = this.#touchPath(r.spanPath, envelope);
      const owner = r.invocationId ?? invocationId;
      const failed = r.outcome?.ok !== true;
      this.#db
        .prepare(
          `INSERT INTO asks (ask_id, trace_id, invocation_id, def, kind, site, provider, profile, status, started_at, duration_ms, attempts, outcome_error, fingerprint, receipt_json)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT (ask_id) DO UPDATE SET
             site = COALESCE(asks.site, excluded.site),
             provider = COALESCE(excluded.provider, asks.provider),
             profile = excluded.profile,
             status = excluded.status,
             duration_ms = excluded.duration_ms,
             attempts = excluded.attempts,
             outcome_error = excluded.outcome_error,
             fingerprint = excluded.fingerprint,
             invocation_id = COALESCE(asks.invocation_id, excluded.invocation_id),
             def = COALESCE(excluded.def, asks.def),
             kind = COALESCE(excluded.kind, asks.kind),
             receipt_json = excluded.receipt_json`,
        )
        .run(
          askId,
          traceId,
          owner,
          r.def ?? null,
          r.kind ?? null,
          siteText(r.site),
          r.servedBy ?? null,
          r.profile ?? null,
          failed ? "error" : "ok",
          envelope.at,
          r.durationMs ?? null,
          r.attempts ?? null,
          failed ? (r.outcome?.error ?? "unknown error") : null,
          r.fingerprint ?? null,
          JSON.stringify((envelope.event as EndEvent).receipt ?? null),
        );
      if (failed) this.#flipAncestors(owner);
    } else if (envelope.kind === "invocationEnd") {
      const e = envelope.event as InvocationEndEvent;
      if (typeof e.invocationId !== "string") return;
      const known = this.#db.prepare("SELECT 1 FROM invocations WHERE invocation_id = ?").get(e.invocationId);
      if (!known) {
        // No start and no ask named it: a root unless the event says otherwise.
        const parent = e.parentInvocationId ?? null;
        this.#touchInvocation(e.invocationId, parent ?? e.invocationId, parent, parent ? 1 : 0, envelope);
      }
      const status = e.status === "error" || this.#subtreeErrored(e.invocationId) ? "error" : "ok";
      this.#db
        .prepare(
          `UPDATE invocations SET
             completed_at = ?,
             duration_ms = COALESCE(?, ? - started_at),
             fn = COALESCE(?, fn),
             file = COALESCE(?, file),
             trace_json = CASE WHEN parent_id IS NULL THEN ? ELSE trace_json END,
             status = ?
           WHERE invocation_id = ?`,
        )
        .run(
          envelope.at,
          e.durationMs ?? null,
          envelope.at,
          e.trace?.fn ?? null,
          e.trace?.file ?? null,
          JSON.stringify(e.trace ?? null),
          status,
          e.invocationId,
        );
      if (status === "error") this.#flipAncestors(e.invocationId);
    }
  }

  async listProjects(): Promise<ProjectSummary[]> {
    const named = this.#db
      .prepare(
        `SELECT p.name, p.first_seen_at, p.last_seen_at, COUNT(t.invocation_id) AS trace_count
         FROM projects p LEFT JOIN invocations t ON t.project = p.name AND t.parent_id IS NULL
         GROUP BY p.name ORDER BY p.last_seen_at DESC`,
      )
      .all() as Array<{ name: string; first_seen_at: number; last_seen_at: number; trace_count: number }>;
    const projects: ProjectSummary[] = named.map((r) => ({
      name: r.name,
      firstSeenAt: r.first_seen_at,
      lastSeenAt: r.last_seen_at,
      traceCount: r.trace_count,
    }));
    const bucket = this.#db
      .prepare(
        "SELECT COUNT(*) AS trace_count, MIN(started_at) AS first_seen, MAX(started_at) AS last_seen FROM invocations WHERE project IS NULL AND parent_id IS NULL",
      )
      .get() as { trace_count: number; first_seen: number | null; last_seen: number | null };
    if (bucket.trace_count > 0)
      projects.push({
        name: null,
        firstSeenAt: bucket.first_seen ?? 0,
        lastSeenAt: bucket.last_seen ?? 0,
        traceCount: bucket.trace_count,
      });
    return projects;
  }

  /** The flattened subtree of one invocation: the node, then children (invocations and asks interleaved by start) depth-first. */
  #subtree(invocationId: string): TraceRecord[] {
    const invocations = this.#db
      .prepare(
        `${SUBTREE} SELECT * FROM invocations WHERE invocation_id IN (SELECT id FROM sub) ORDER BY started_at, invocation_id`,
      )
      .all(invocationId) as InvocationRow[];
    const asks = this.#db
      .prepare(
        `${SUBTREE} SELECT a.*, i.depth AS depth FROM asks a JOIN invocations i ON i.invocation_id = a.invocation_id
         WHERE a.invocation_id IN (SELECT id FROM sub) ORDER BY a.started_at, a.ask_id`,
      )
      .all(invocationId) as AskRow[];
    const root = invocations.find((i) => i.invocation_id === invocationId);
    if (!root) return [];
    const byParent = new Map<string, Array<InvocationRow | AskRow>>();
    const push = (parent: string | null, row: InvocationRow | AskRow): void => {
      if (parent === null) return;
      const list = byParent.get(parent) ?? [];
      list.push(row);
      byParent.set(parent, list);
    };
    for (const i of invocations) if (i.invocation_id !== invocationId) push(i.parent_id, i);
    for (const a of asks) push(a.invocation_id, a);
    const out: TraceRecord[] = [];
    const visit = (row: InvocationRow): { asks: number; errors: number } => {
      const record = toInvocationRecord(row);
      const at = out.length;
      out.push(record);
      const children = [...(byParent.get(row.invocation_id) ?? [])].sort(
        (x, y) => x.started_at - y.started_at || rowId(x).localeCompare(rowId(y)),
      );
      let askCount = 0;
      let errorCount = 0;
      for (const item of children) {
        if ("ask_id" in item) {
          out.push(toAskRecord(item));
          askCount += 1;
          if (item.status === "error") errorCount += 1;
        } else {
          const sub = visit(item);
          askCount += sub.asks;
          errorCount += sub.errors;
        }
      }
      out[at] = { ...record, askCount, errorCount };
      return { asks: askCount, errors: errorCount };
    };
    visit(root);
    return out;
  }

  async listRecords(query: RecordsQuery = {}): Promise<TraceRecord[]> {
    const clauses: string[] = ["parent_id IS NULL"];
    const params: Array<string | number> = [];
    if (query.project !== undefined) {
      clauses.push("project = ?");
      params.push(query.project);
    }
    if (query.noProject) clauses.push("project IS NULL");
    if (query.runId !== undefined) {
      clauses.push("run_id = ?");
      params.push(query.runId);
    }
    const roots = this.#db
      .prepare(
        `SELECT invocation_id FROM invocations WHERE ${clauses.join(" AND ")} ORDER BY started_at DESC, invocation_id DESC LIMIT ?`,
      )
      .all(...params, query.limit ?? 100) as Array<{ invocation_id: string }>;
    return roots.flatMap((r) => this.#subtree(r.invocation_id));
  }

  async getTrace(invocationId: string): Promise<TraceDetail | undefined> {
    const records = this.#subtree(invocationId);
    const node = records[0];
    if (node?.kind !== "invocation") return undefined;
    const row = this.#db.prepare("SELECT trace_json FROM invocations WHERE invocation_id = ?").get(invocationId) as {
      trace_json: string | null;
    };
    return { node, records, ...(row.trace_json ? { trace: JSON.parse(row.trace_json) as unknown } : {}) };
  }

  #invocationChain(invocationId: string): InvocationLink[] {
    const chain: InvocationLink[] = [];
    const stmt = this.#db.prepare("SELECT invocation_id, parent_id, fn, depth FROM invocations WHERE invocation_id = ?");
    for (let id: string | null = invocationId; id !== null; ) {
      const row = stmt.get(id) as
        | { invocation_id: string; parent_id: string | null; fn: string | null; depth: number }
        | undefined;
      if (!row) break;
      chain.unshift({ invocationId: row.invocation_id, ...(row.fn !== null ? { fn: row.fn } : {}), depth: row.depth });
      id = row.parent_id;
    }
    return chain;
  }

  async getAsk(askId: string): Promise<AskDetail | undefined> {
    const row = this.#db.prepare(`${ASK_SELECT} WHERE a.ask_id = ?`).get(askId) as AskRow | undefined;
    if (!row) return undefined;
    const events = (
      this.#db.prepare("SELECT seq, at, kind, event_json FROM events WHERE ask_id = ? ORDER BY seq").all(askId) as Array<{
        seq: number;
        at: number;
        kind: string;
        event_json: string;
      }>
    ).map((e) => ({ seq: e.seq, at: e.at, kind: e.kind as NolaIngestKind, event: JSON.parse(e.event_json) as unknown }));
    const attemptRows = (
      this.#db.prepare("SELECT * FROM attempts WHERE ask_id = ? ORDER BY attempt").all(askId) as AttemptRow[]
    ).map(toAttemptSummary);
    return {
      ...toAskSummary(row),
      attemptRows,
      ...(row.receipt_json ? { receipt: JSON.parse(row.receipt_json) as unknown } : {}),
      events,
      invocationChain: this.#invocationChain(row.invocation_id),
    };
  }

  #definitionStats(def: string): Pick<
    DefinitionSummary,
    "executions" | "okCount" | "errorCount" | "avgDurationMs" | "p95DurationMs" | "avgAttempts" | "providers"
  > {
    const agg = this.#db
      .prepare(
        `SELECT COUNT(*) AS executions,
                COALESCE(SUM(status = 'ok'), 0) AS ok_count,
                COALESCE(SUM(status = 'error'), 0) AS error_count,
                AVG(duration_ms) AS avg_ms,
                AVG(attempts) AS avg_att
         FROM asks WHERE def = ?`,
      )
      .get(def) as {
      executions: number;
      ok_count: number;
      error_count: number;
      avg_ms: number | null;
      avg_att: number | null;
    };
    const durations = (
      this.#db
        .prepare("SELECT duration_ms AS d FROM asks WHERE def = ? AND duration_ms IS NOT NULL ORDER BY duration_ms")
        .all(def) as Array<{ d: number }>
    ).map((r) => r.d);
    const p95 = durations.length > 0 ? durations[Math.ceil(0.95 * durations.length) - 1] : undefined;
    const providers = (
      this.#db
        .prepare("SELECT DISTINCT provider AS p FROM asks WHERE def = ? AND provider IS NOT NULL ORDER BY provider")
        .all(def) as Array<{ p: string }>
    ).map((r) => r.p);
    return {
      executions: agg.executions,
      okCount: agg.ok_count,
      errorCount: agg.error_count,
      ...(agg.avg_ms !== null ? { avgDurationMs: agg.avg_ms } : {}),
      ...(p95 !== undefined ? { p95DurationMs: p95 } : {}),
      ...(agg.avg_att !== null ? { avgAttempts: agg.avg_att } : {}),
      providers,
    };
  }

  async listDefinitions(query: { project?: string; noProject?: boolean } = {}): Promise<DefinitionSummary[]> {
    const clauses: string[] = [];
    const params: string[] = [];
    if (query.project !== undefined) {
      clauses.push("project = ?");
      params.push(query.project);
    }
    if (query.noProject) clauses.push("project IS NULL");
    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const rows = this.#db
      .prepare(`SELECT * FROM definitions ${where} ORDER BY last_seen_at DESC, def DESC`)
      .all(...params) as DefinitionRow[];
    return rows.map((row) => ({ ...toDefinitionBase(row), ...this.#definitionStats(row.def) }));
  }

  async getDefinition(def: string, query: DefinitionAsksQuery = {}): Promise<DefinitionDetail | undefined> {
    const row = this.#db.prepare("SELECT * FROM definitions WHERE def = ?").get(def) as DefinitionRow | undefined;
    if (!row) return undefined;
    const clauses = ["a.def = ?"];
    const params: Array<string | number> = [def];
    const bound = (sql: string, value: number | undefined): void => {
      if (value === undefined) return;
      clauses.push(sql);
      params.push(value);
    };
    bound("a.started_at >= ?", query.from);
    bound("a.started_at <= ?", query.to);
    // NULL fails every comparison, so a duration bound skips executions that have none yet
    bound("a.duration_ms >= ?", query.dmin);
    bound("a.duration_ms <= ?", query.dmax);
    bound("t.pid = ?", query.pid);
    const where = clauses.join(" AND ");
    const { matched } = this.#db.prepare(`SELECT COUNT(*) AS matched ${ASK_FROM} WHERE ${where}`).get(...params) as {
      matched: number;
    };
    const asks = (
      this.#db
        .prepare(`${ASK_SELECT} WHERE ${where} ORDER BY a.started_at DESC, a.ask_id DESC LIMIT ?`)
        .all(...params, query.limit ?? DEFAULT_DEFINITION_ASKS_LIMIT) as AskRow[]
    ).map(toAskSummary);
    return { ...toDefinitionBase(row), ...this.#definitionStats(row.def), asks, matched };
  }

  async clear(): Promise<void> {
    this.#db.exec("BEGIN");
    for (const table of ["events", "attempts", "asks", "definitions", "invocations", "projects"])
      this.#db.exec(`DELETE FROM ${table}`);
    this.#db.exec("COMMIT");
  }

  async close(): Promise<void> {
    this.#db.close();
  }
}

type DefinitionRow = {
  def: string;
  project: string | null;
  kind: string | null;
  file: string | null;
  loc: string | null;
  instruction: string | null;
  first_seen_at: number;
  last_seen_at: number;
};

function toDefinitionBase(
  row: DefinitionRow,
): Pick<DefinitionSummary, "def" | "project" | "kind" | "file" | "loc" | "instruction" | "firstSeenAt" | "lastSeenAt"> {
  return {
    def: row.def,
    ...(row.project !== null ? { project: row.project } : {}),
    ...(row.kind !== null ? { kind: askKind(row.kind) } : {}),
    ...(row.file !== null ? { file: row.file } : {}),
    ...(row.loc !== null ? { loc: row.loc } : {}),
    ...(row.instruction !== null ? { instruction: row.instruction } : {}),
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
  };
}

type InvocationRow = {
  invocation_id: string;
  trace_id: string;
  parent_id: string | null;
  depth: number;
  detached: number;
  project: string | null;
  run_id: string;
  pid: number;
  status: string;
  fn: string | null;
  file: string | null;
  started_at: number;
  completed_at: number | null;
  duration_ms: number | null;
  trace_json: string | null;
};

type AskRow = {
  pid: number | null;
  ask_id: string;
  trace_id: string;
  invocation_id: string;
  def: string | null;
  kind: string | null;
  site: string | null;
  instruction: string | null;
  callee: string | null;
  hint: string | null;
  type_text: string | null;
  provider: string | null;
  profile: string | null;
  status: string;
  started_at: number;
  duration_ms: number | null;
  attempts: number | null;
  outcome_error: string | null;
  receipt_json: string | null;
  /** the owning invocation's depth — joined in by #subtree only (ASK_SELECT leaves it undefined) */
  depth?: number;
};

const rowId = (row: InvocationRow | AskRow): string => ("ask_id" in row ? row.ask_id : row.invocation_id);

/** Every ask row carries its trace's pid — the process is a filter attribute of the execution. */
const ASK_FROM = "FROM asks a LEFT JOIN invocations t ON t.invocation_id = a.trace_id";
const ASK_SELECT = `SELECT a.*, t.pid AS pid ${ASK_FROM}`;

/** The ask fields shared by AskSummary and AskRecord; `kind` is always resolved (legacy NULL reads as extract). */
type AskFields = {
  kind: AskKind;
  def?: string;
  site?: string;
  instruction?: string;
  callee?: string;
  hint?: string;
  typeText?: string;
  provider?: string;
  profile?: string;
  attempts?: number;
  error?: string;
};

function toInvocationRecord(row: InvocationRow): InvocationRecord {
  return {
    id: row.invocation_id,
    kind: "invocation",
    traceId: row.trace_id,
    ...(row.parent_id !== null ? { parentId: row.parent_id } : {}),
    depth: row.depth,
    label: invocationLabel(row.fn ?? undefined),
    status: row.status as InvocationRecord["status"],
    startedAt: row.started_at,
    ...(row.duration_ms !== null ? { durationMs: row.duration_ms } : {}),
    ...(row.fn !== null ? { fn: row.fn } : {}),
    ...(row.file !== null ? { file: row.file } : {}),
    detached: row.detached === 1,
    ...(row.project !== null ? { project: row.project } : {}),
    runId: row.run_id,
    pid: row.pid,
    ...(row.completed_at !== null ? { completedAt: row.completed_at } : {}),
    askCount: 0,
    errorCount: 0,
  };
}

function askFields(row: AskRow): AskFields {
  return {
    kind: askKind(row.kind),
    ...(row.def !== null ? { def: row.def } : {}),
    ...(row.site !== null ? { site: row.site } : {}),
    ...(row.instruction !== null ? { instruction: row.instruction } : {}),
    ...(row.callee !== null ? { callee: row.callee } : {}),
    ...(row.hint !== null ? { hint: row.hint } : {}),
    ...(row.type_text !== null ? { typeText: row.type_text } : {}),
    ...(row.provider !== null ? { provider: row.provider } : {}),
    ...(row.profile !== null ? { profile: row.profile } : {}),
    ...(row.attempts !== null ? { attempts: row.attempts } : {}),
    ...(row.outcome_error !== null ? { error: row.outcome_error } : {}),
  };
}

function toAskRecord(row: AskRow): AskRecord {
  const fields = askFields(row);
  return {
    id: row.ask_id,
    traceId: row.trace_id,
    parentId: row.invocation_id,
    // one below the owning invocation
    depth: 1 + (row.depth ?? 0),
    label: askLabel(fields),
    status: row.status as AskRecord["status"],
    startedAt: row.started_at,
    ...(row.duration_ms !== null ? { durationMs: row.duration_ms } : {}),
    ...fields,
  };
}

function toAskSummary(row: AskRow): AskSummary {
  return {
    askId: row.ask_id,
    traceId: row.trace_id,
    ...(row.pid !== null ? { pid: row.pid } : {}),
    ...askFields(row),
    status: row.status as AskSummary["status"],
    startedAt: row.started_at,
    ...(row.duration_ms !== null ? { durationMs: row.duration_ms } : {}),
  };
}

type AttemptRow = {
  ask_id: string;
  attempt: number;
  provider: string | null;
  at: number;
  duration_ms: number | null;
  validation: string | null;
};

function toAttemptSummary(row: AttemptRow): AttemptSummary {
  return {
    attempt: row.attempt,
    ...(row.provider !== null ? { provider: row.provider } : {}),
    at: row.at,
    ...(row.duration_ms !== null ? { durationMs: row.duration_ms } : {}),
    ...(row.validation === "failed" ? { validation: "failed" } : {}),
  };
}
