import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { SqliteConsoleStorage } from "@nola-lang/console";
import type { NolaIngestEnvelope, NolaIngestKind } from "@nola-lang/core";
import { describe, expect, it } from "vitest";

const dbFile = () => join(mkdtempSync(join(tmpdir(), "nola-console-db-")), "console.db");

let seq = 0;
const env = (kind: NolaIngestKind, event: unknown, over: Partial<NolaIngestEnvelope> = {}): NolaIngestEnvelope => ({
  v: 1,
  runId: "run-1",
  pid: 7,
  project: "shop",
  seq: seq++,
  at: 1000 + seq,
  kind,
  event,
  ...over,
});

const DEF = "d1".repeat(32);

const askStart = (over: Record<string, unknown> = {}) =>
  env("askStart", {
    askId: "a1",
    site: { file: "main.tsi", loc: "3:7" },
    provider: "mock",
    invocationId: "inv-root",
    spanPath: ["inv-root"],
    def: DEF,
    instruction: "triage the customer message",
    kind: "extract",
    typeText: "Ticket",
    ...over,
  });

const receipt = (over: Record<string, unknown> = {}) => ({
  askId: "a1",
  site: { file: "main.tsi", loc: "3:7" },
  servedBy: "mock",
  attempts: 2,
  durationMs: 120,
  outcome: { ok: true, value: "x" },
  fingerprint: "f".repeat(64),
  profile: "fast",
  invocationId: "inv-root",
  spanPath: ["inv-root"],
  def: DEF,
  kind: "extract",
  ...over,
});

const invocationStart = (over: Record<string, unknown> = {}) =>
  env("invocationStart", {
    invocationId: "inv-root",
    spanPath: ["inv-root"],
    fn: "triage",
    file: "main.tsi",
    detached: false,
    ...over,
  });

const invocationEnd = (over: Record<string, unknown> = {}) =>
  env("invocationEnd", {
    invocationId: "inv-root",
    status: "ok",
    durationMs: 300,
    trace: { kind: "invocation", invocationId: "inv-root", fn: "triage", file: "main.tsi", spans: [] },
    ...over,
  });

const child = (over: Record<string, unknown> = {}) =>
  invocationStart({
    invocationId: "inv-child",
    parentInvocationId: "inv-root",
    spanPath: ["inv-root", "inv-child"],
    fn: "notify",
    ...over,
  });

describe("SqliteConsoleStorage — records", () => {
  it("materializes a running root from invocationStart, then its ask and attempts, then completion", async () => {
    const s = new SqliteConsoleStorage(dbFile());
    await s.ingest(invocationStart());
    let records = await s.listRecords({ project: "shop" });
    expect(records).toMatchObject([
      {
        kind: "invocation",
        id: "inv-root",
        traceId: "inv-root",
        depth: 0,
        label: "triage(..)",
        status: "running",
        fn: "triage",
        file: "main.tsi",
        detached: false,
        runId: "run-1",
        pid: 7,
        askCount: 0,
        errorCount: 0,
      },
    ]);
    expect(records[0]?.parentId).toBeUndefined();

    await s.ingest(askStart());
    await s.ingest(env("providerRequest", { askId: "a1", attempt: 1, provider: "mock" }));
    await s.ingest(env("providerResponse", { askId: "a1", attempt: 1, provider: "mock", text: "no", durationMs: 50 }));
    await s.ingest(env("validationFailed", { askId: "a1", attempt: 1, error: "expected string" }));
    await s.ingest(env("providerRequest", { askId: "a1", attempt: 2, provider: "mock" }));
    await s.ingest(env("providerResponse", { askId: "a1", attempt: 2, provider: "mock", text: "x", durationMs: 60 }));
    await s.ingest(env("askEnd", { askId: "a1", receipt: receipt() }));
    records = await s.listRecords({ project: "shop" });
    expect(records).toMatchObject([
      { kind: "invocation", id: "inv-root", status: "running", askCount: 1, errorCount: 0 },
      {
        kind: "extract",
        id: "a1",
        traceId: "inv-root",
        parentId: "inv-root",
        depth: 1,
        label: "..`triage the customer message`<Ticket>",
        status: "ok",
        site: "main.tsi:3:7",
        provider: "mock",
        profile: "fast",
        attempts: 2,
        typeText: "Ticket",
      },
    ]);

    await s.ingest(invocationEnd());
    records = await s.listRecords({ project: "shop" });
    expect(records[0]).toMatchObject({ status: "ok", durationMs: 300 });
    expect((records[0] as { completedAt?: number }).completedAt).toBeTypeOf("number");
    expect(await s.listProjects()).toMatchObject([{ name: "shop", traceCount: 1 }]);

    const ask = await s.getAsk("a1");
    expect(ask?.attemptRows).toMatchObject([
      { attempt: 1, provider: "mock", durationMs: 50, validation: "failed" },
      { attempt: 2, provider: "mock", durationMs: 60 },
    ]);
    expect("validation" in (ask?.attemptRows[1] as object)).toBe(false);
    expect(ask?.kind).toBe("extract");
    expect(ask?.pid).toBe(7);
    expect(ask?.invocationChain).toEqual([{ invocationId: "inv-root", fn: "triage", depth: 0 }]);
    expect(ask?.events).toHaveLength(7);
    await s.close();
  });

  it("flattens a nested trace root-first: root, attached invocation, its extract and call, then the root's later ask", async () => {
    const s = new SqliteConsoleStorage(dbFile());
    await s.ingest(invocationStart());
    await s.ingest(child());
    await s.ingest(askStart({ askId: "a-ext", invocationId: "inv-child", spanPath: ["inv-root", "inv-child"] }));
    await s.ingest(
      askStart({
        askId: "a-call",
        invocationId: "inv-child",
        spanPath: ["inv-root", "inv-child"],
        kind: "call",
        callee: "send",
        hint: "politely",
        instruction: 'Generate the arguments for calling the function "send". politely',
        typeText: undefined,
      }),
    );
    await s.ingest(
      env("askEnd", {
        askId: "a-ext",
        receipt: receipt({ askId: "a-ext", invocationId: "inv-child", spanPath: ["inv-root", "inv-child"] }),
      }),
    );
    await s.ingest(
      env("askEnd", {
        askId: "a-call",
        receipt: receipt({ askId: "a-call", invocationId: "inv-child", spanPath: ["inv-root", "inv-child"], kind: "call" }),
      }),
    );
    await s.ingest(
      invocationEnd({
        invocationId: "inv-child",
        parentInvocationId: "inv-root",
        durationMs: 80,
        trace: { kind: "invocation", invocationId: "inv-child", fn: "notify", file: "main.tsi", spans: [] },
      }),
    );
    await s.ingest(askStart({ askId: "a-late" }));
    await s.ingest(env("askEnd", { askId: "a-late", receipt: receipt({ askId: "a-late" }) }));
    await s.ingest(invocationEnd());

    const records = await s.listRecords({ project: "shop" });
    expect(records.map((r) => [r.kind, r.id, r.depth])).toEqual([
      ["invocation", "inv-root", 0],
      ["invocation", "inv-child", 1],
      ["extract", "a-ext", 2],
      ["call", "a-call", 2],
      ["extract", "a-late", 1],
    ]);
    expect(records[3]).toMatchObject({ label: "send`politely`(..)", callee: "send", hint: "politely" });
    expect(records[1]).toMatchObject({
      label: "notify(..)",
      status: "ok",
      durationMs: 80,
      askCount: 2,
      errorCount: 0,
      parentId: "inv-root",
    });
    expect(records[0]).toMatchObject({ askCount: 3 });

    const sub = await s.getTrace("inv-child");
    expect(sub?.node.id).toBe("inv-child");
    expect(sub?.records.map((r) => r.id)).toEqual(["inv-child", "a-ext", "a-call"]);
    expect(sub?.trace).toBeUndefined();
    const root = await s.getTrace("inv-root");
    expect(root?.records).toHaveLength(5);
    expect(root?.trace).toMatchObject({ fn: "triage" });

    const chain = (await s.getAsk("a-call"))?.invocationChain;
    expect(chain).toEqual([
      { invocationId: "inv-root", fn: "triage", depth: 0 },
      { invocationId: "inv-child", fn: "notify", depth: 1 },
    ]);
    await s.close();
  });

  it("an ask error propagates to every completed ancestor; a failing child invocation reddens the root", async () => {
    const s = new SqliteConsoleStorage(dbFile());
    await s.ingest(invocationStart());
    await s.ingest(child());
    await s.ingest(askStart({ askId: "a-bad", invocationId: "inv-child", spanPath: ["inv-root", "inv-child"] }));
    await s.ingest(invocationEnd({ invocationId: "inv-child", parentInvocationId: "inv-root", status: "error" }));
    await s.ingest(invocationEnd({ status: "error" }));
    // the ask's own end arrives late
    await s.ingest(
      env("askEnd", {
        askId: "a-bad",
        receipt: receipt({
          askId: "a-bad",
          invocationId: "inv-child",
          spanPath: ["inv-root", "inv-child"],
          outcome: { ok: false, error: "NOLA3011: boom" },
        }),
      }),
    );
    const records = await s.listRecords({ project: "shop" });
    expect(records.map((r) => [r.id, r.status])).toEqual([
      ["inv-root", "error"],
      ["inv-child", "error"],
      ["a-bad", "error"],
    ]);
    expect(records[0]).toMatchObject({ errorCount: 1 });
    await s.close();
  });

  it("a root is running until its invocationEnd; a late errored askEnd flips a completed root", async () => {
    const s = new SqliteConsoleStorage(dbFile());
    await s.ingest(askStart());
    expect((await s.listRecords())[0]?.status).toBe("running");
    await s.ingest(env("askEnd", { askId: "a1", receipt: receipt({ outcome: { ok: false, error: "boom" } }) }));
    expect((await s.listRecords())[0]?.status).toBe("running"); // not completed yet
    await s.ingest(invocationEnd());
    expect((await s.listRecords())[0]).toMatchObject({ status: "error", errorCount: 1 });

    const t = new SqliteConsoleStorage(dbFile());
    await t.ingest(askStart());
    await t.ingest(invocationEnd());
    expect((await t.listRecords())[0]?.status).toBe("ok");
    await t.ingest(env("askEnd", { askId: "a1", receipt: receipt({ outcome: { ok: false, error: "late" } }) }));
    expect((await t.listRecords())[0]?.status).toBe("error");
    await s.close();
    await t.close();
  });

  it("mints placeholder invocations from a spanPath when no invocationStart arrived, and the run:<id> fallback without one", async () => {
    const s = new SqliteConsoleStorage(dbFile());
    await s.ingest(askStart({ invocationId: "inv-child", spanPath: ["inv-root", "inv-child"] }));
    let records = await s.listRecords({ project: "shop" });
    expect(records.map((r) => [r.kind, r.id, r.depth, r.label])).toEqual([
      ["invocation", "inv-root", 0, "<anonymous>(..)"],
      ["invocation", "inv-child", 1, "<anonymous>(..)"],
      ["extract", "a1", 2, "..`triage the customer message`<Ticket>"],
    ]);
    await s.ingest(child());
    records = await s.listRecords({ project: "shop" });
    expect(records[1]).toMatchObject({ label: "notify(..)" });

    const t = new SqliteConsoleStorage(dbFile());
    await t.ingest(askStart({ askId: "legacy", invocationId: undefined, spanPath: undefined }));
    const legacy = await t.listRecords({ project: "shop" });
    expect(legacy.map((r) => [r.kind, r.id])).toEqual([
      ["invocation", "run:run-1"],
      ["extract", "legacy"],
    ]);
    await s.close();
    await t.close();
  });

  it("orders roots newest-first, counts limit in roots, and filters by project / noProject / runId", async () => {
    const s = new SqliteConsoleStorage(dbFile());
    await s.ingest(invocationStart({ invocationId: "old", spanPath: ["old"] }));
    await s.ingest(askStart({ askId: "old-ask", invocationId: "old", spanPath: ["old"] }));
    await s.ingest(invocationStart({ invocationId: "new", spanPath: ["new"] }));
    await s.ingest(invocationStart({ invocationId: "other", spanPath: ["other"] }));
    await s.ingest(
      env(
        "invocationStart",
        { invocationId: "noproj", spanPath: ["noproj"], fn: "f", file: "z.tsi", detached: true },
        { project: undefined, runId: "run-2" },
      ),
    );

    const all = await s.listRecords();
    expect(all.map((r) => r.id)).toEqual(["noproj", "other", "new", "old", "old-ask"]);
    expect(await s.listRecords({ limit: 1 })).toHaveLength(1);
    expect((await s.listRecords({ project: "shop", limit: 3 })).map((r) => r.id)).toEqual(["other", "new", "old", "old-ask"]);
    expect((await s.listRecords({ noProject: true })).map((r) => r.id)).toEqual(["noproj"]);
    expect((await s.listRecords({ noProject: true }))[0]).toMatchObject({ detached: true });
    expect((await s.listRecords({ runId: "run-2" })).map((r) => r.id)).toEqual(["noproj"]);
    expect(await s.listProjects()).toMatchObject([
      { name: "shop", traceCount: 3 },
      { name: null, traceCount: 1 },
    ]);
    await s.close();
  });

  it("legacy asks without a kind read as extract; definitions carry the last-seen kind", async () => {
    const s = new SqliteConsoleStorage(dbFile());
    await s.ingest(askStart({ kind: undefined, typeText: undefined }));
    expect((await s.listRecords())[1]).toMatchObject({ kind: "extract", label: "..`triage the customer message`" });
    await s.ingest(askStart({ askId: "a2", kind: "call", callee: "f", hint: "" }));
    expect((await s.listDefinitions({ project: "shop" }))[0]?.kind).toBe("call");
    await s.close();
  });

  it("out-of-order arrival: askEnd before askStart still completes the ask and the trace exists", async () => {
    const s = new SqliteConsoleStorage(dbFile());
    await s.ingest(env("askEnd", { askId: "a1", receipt: receipt() }));
    await s.ingest(askStart());
    const detail = await s.getTrace("inv-root");
    expect(detail?.records[1]).toMatchObject({ id: "a1", status: "ok", site: "main.tsi:3:7", durationMs: 120 });
    await s.close();
  });

  it("getAsk returns the receipt and the events ordered by seq; unknown ids are undefined", async () => {
    const s = new SqliteConsoleStorage(dbFile());
    await s.ingest(env("askEnd", { askId: "a1", receipt: receipt() }, { seq: 102 }));
    await s.ingest({ ...askStart(), seq: 100 });
    await s.ingest(env("providerResponse", { askId: "a1", attempt: 1, provider: "mock", text: "t", durationMs: 5 }, { seq: 101 }));
    const detail = await s.getAsk("a1");
    expect(detail?.events.map((e) => e.seq)).toEqual([100, 101, 102]);
    expect(detail?.receipt).toMatchObject({ servedBy: "mock" });
    expect(detail?.traceId).toBe("inv-root");
    expect(await s.getAsk("nope")).toBeUndefined();
    expect(await s.getTrace("nope")).toBeUndefined();
    await s.close();
  });

  it("wipes a database stamped with a different schema version", async () => {
    const file = dbFile();
    const old = new DatabaseSync(file);
    old.exec("CREATE TABLE traces (x INTEGER); PRAGMA user_version = 6");
    old.close();
    const s = new SqliteConsoleStorage(file);
    expect(await s.listRecords()).toEqual([]); // fresh db, old table gone
    await s.close();
    const fresh = new DatabaseSync(file);
    expect((fresh.prepare("PRAGMA user_version").get() as { user_version: number }).user_version).toBe(7);
    expect(fresh.prepare("SELECT name FROM sqlite_master WHERE name = 'invocations'").get()).toBeTruthy();
    fresh.close();
    const reopened = new SqliteConsoleStorage(file); // matching stamp: no wipe, still serves
    expect(await reopened.listRecords()).toEqual([]);
    await reopened.close();
  });

  it("clear() empties every table; a later ingest starts a fresh stream", async () => {
    const storage = new SqliteConsoleStorage(":memory:");
    for (const e of [invocationStart(), askStart(), env("askEnd", { askId: "a1", receipt: receipt() }), invocationEnd()])
      await storage.ingest(e);
    expect(await storage.listRecords()).toHaveLength(2);
    await storage.clear();
    expect(await storage.listRecords()).toEqual([]);
    expect(await storage.listProjects()).toEqual([]);
    expect(await storage.listDefinitions()).toEqual([]);
    expect(await storage.getAsk("a1")).toBeUndefined();
    expect(await storage.getTrace("inv-root")).toBeUndefined();
    // the events table is gone too: the same (runId, seq) is no longer a duplicate
    await storage.ingest(invocationStart({ invocationId: "inv-2", spanPath: ["inv-2"] }));
    expect((await storage.listRecords()).map((r) => r.id)).toEqual(["inv-2"]);
  });

  it("duplicate (runId, seq) delivery is idempotent", async () => {
    const s = new SqliteConsoleStorage(dbFile());
    const e = askStart();
    await s.ingest(e);
    await s.ingest(e);
    expect((await s.getAsk("a1"))?.events).toHaveLength(1);
    await s.close();
  });
});

describe("definition executions query", () => {
  /** a1 1000/120ms/pid 7 · a2 2000/80ms/pid 7 · a3 3000/500ms/pid 8 · a4 4000/running/pid 7 */
  const seeded = async () => {
    const s = new SqliteConsoleStorage(dbFile());
    const run = async (askId: string, at: number, durationMs: number | undefined, over: Partial<NolaIngestEnvelope> = {}) => {
      const invocationId = `inv-${askId}`;
      await s.ingest(env("askStart", { ...(askStart().event as object), askId, invocationId, spanPath: [invocationId] }, { at, ...over }));
      if (durationMs !== undefined)
        await s.ingest(
          env("askEnd", { askId, receipt: receipt({ askId, durationMs, invocationId, spanPath: [invocationId] }) }, { at, ...over }),
        );
    };
    await run("a1", 1000, 120);
    await run("a2", 2000, 80);
    await run("a3", 3000, 500, { pid: 8, runId: "run-2" });
    await run("a4", 4000, undefined);
    return s;
  };
  const ids = (d: { asks: Array<{ askId: string }> } | undefined) => d?.asks.map((a) => a.askId);

  it("narrows by time, duration and pid over ALL executions, and reports the matched total", async () => {
    const s = await seeded();
    const all = await s.getDefinition(DEF);
    expect(ids(all)).toEqual(["a4", "a3", "a2", "a1"]);
    expect(all).toMatchObject({ executions: 4, matched: 4 });

    const timed = await s.getDefinition(DEF, { from: 2000, to: 3000 }); // inclusive on both sides
    expect(ids(timed)).toEqual(["a3", "a2"]);
    // the stats stay definition-wide; `matched` is what the filter selected
    expect(timed).toMatchObject({ executions: 4, matched: 2 });

    // a duration bound needs a value: the running execution never matches one
    expect(ids(await s.getDefinition(DEF, { dmin: 100 }))).toEqual(["a3", "a1"]);
    expect(ids(await s.getDefinition(DEF, { dmax: 100 }))).toEqual(["a2"]);
    expect(ids(await s.getDefinition(DEF, { pid: 8 }))).toEqual(["a3"]);
    expect(ids(await s.getDefinition(DEF, { from: 1000, dmax: 200, pid: 7 }))).toEqual(["a2", "a1"]);
    await s.close();
  });

  it("applies the limit AFTER the filter, newest first", async () => {
    const s = await seeded();
    const limited = await s.getDefinition(DEF, { limit: 2 });
    expect(ids(limited)).toEqual(["a4", "a3"]);
    expect(limited?.matched).toBe(4);
    // an old window is reachable no matter how many newer executions exist
    expect(ids(await s.getDefinition(DEF, { to: 2000, limit: 1 }))).toEqual(["a2"]);
    await s.close();
  });

  it("returns more than 50 executions by default", async () => {
    const s = new SqliteConsoleStorage(dbFile());
    for (let i = 0; i < 60; i++)
      await s.ingest(askStart({ askId: `b${i}`, invocationId: `inv-b${i}`, spanPath: [`inv-b${i}`] }));
    expect((await s.getDefinition(DEF))?.asks).toHaveLength(60);
    await s.close();
  });
});

describe("definitions", () => {
  it("upserts a definition from askStart and aggregates stats over asks", async () => {
    const s = new SqliteConsoleStorage(dbFile());
    await s.ingest(askStart());
    await s.ingest(env("askEnd", { askId: "a1", receipt: receipt() }));
    await s.ingest(askStart({ askId: "a9", invocationId: "inv-9", spanPath: ["inv-9"] }));
    await s.ingest(
      env("askEnd", {
        askId: "a9",
        receipt: receipt({ askId: "a9", durationMs: 80, attempts: 1, outcome: { ok: false, error: "boom" } }),
      }),
    );
    const defs = await s.listDefinitions({ project: "shop" });
    expect(defs).toMatchObject([
      {
        def: DEF,
        project: "shop",
        kind: "extract",
        file: "main.tsi",
        loc: "3:7",
        instruction: "triage the customer message",
        executions: 2,
        okCount: 1,
        errorCount: 1,
        avgDurationMs: 100,
        p95DurationMs: 120,
        avgAttempts: 1.5,
        providers: ["mock"],
      },
    ]);
    expect(await s.listDefinitions({ noProject: true })).toEqual([]);
    const detail = await s.getDefinition(DEF);
    expect(detail?.asks.map((a) => a.askId)).toEqual(["a9", "a1"]); // newest first
    expect(detail?.asks[0]).toMatchObject({ def: DEF, kind: "extract", pid: 7 });
    expect(await s.getDefinition("nope")).toBeUndefined();
    expect((await s.getAsk("a1"))?.def).toBe(DEF);
    await s.close();
  });

  it("asks without a def never appear in definitions", async () => {
    const s = new SqliteConsoleStorage(dbFile());
    await s.ingest(
      env("askStart", {
        askId: "x1",
        site: { file: "f.tsi", loc: "1:1" },
        provider: "mock",
        invocationId: "i",
        spanPath: ["i"],
      }),
    );
    expect(await s.listDefinitions()).toEqual([]);
    await s.close();
  });
});
