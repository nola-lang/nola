import { ConsoleService, createApp, SqliteConsoleStorage } from "@nola-lang/console";
import type { NolaCapabilitiesResponse, NolaIngestEnvelope } from "@nola-lang/core";
import { describe, expect, it } from "vitest";

const setup = () => {
  const service = new ConsoleService(new SqliteConsoleStorage(":memory:"));
  return { service, app: createApp(service) };
};

const envelope: NolaIngestEnvelope = {
  v: 1,
  runId: "r",
  pid: 1,
  seq: 0,
  at: 1,
  project: "shop",
  kind: "askStart",
  event: {
    askId: "a1",
    site: { file: "f.tsi", loc: "1:1" },
    provider: "mock",
    invocationId: "inv-1",
    spanPath: ["inv-1"],
    def: "d1".repeat(32),
    instruction: "triage",
    kind: "extract",
  },
};

describe("wire routes", () => {
  it("GET /v1/capabilities self-describes with ingest: true", async () => {
    const { app } = setup();
    const res = await app.request("/v1/capabilities");
    expect(res.status).toBe(200);
    expect((await res.json()) as NolaCapabilitiesResponse).toEqual({ protocol: 1, infer: false, ingest: true });
  });

  it("POST /v1/ingest stores a valid envelope and returns 204", async () => {
    const { app, service } = setup();
    const res = await app.request("/v1/ingest", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(envelope),
    });
    expect(res.status).toBe(204);
    expect((await service.getAsk("a1"))?.askId).toBe("a1");
  });

  it("rejects a non-envelope and non-JSON with a wire-shaped 400", async () => {
    const { app } = setup();
    const bad = await app.request("/v1/ingest", { method: "POST", body: JSON.stringify({ hello: 1 }) });
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { error: { code: string } }).error.code).toBe("invalid_envelope");
    const notJson = await app.request("/v1/ingest", { method: "POST", body: "{" });
    expect(notJson.status).toBe(400);
  });
});

describe("api routes", () => {
  it("serves projects, the records stream, trace detail, and ask detail", async () => {
    const { app, service } = setup();
    await service.ingest({
      ...envelope,
      seq: 0,
      kind: "invocationStart",
      event: { invocationId: "inv-1", spanPath: ["inv-1"], fn: "triage", file: "f.tsi", detached: false },
    });
    await app.request("/v1/ingest", { method: "POST", body: JSON.stringify({ ...envelope, seq: 1 }) });
    await service.ingest({
      ...envelope,
      seq: 2,
      kind: "providerRequest",
      event: { askId: "a1", attempt: 1, provider: "mock" },
    });
    await service.ingest({
      ...envelope,
      seq: 3,
      kind: "askEnd",
      event: {
        askId: "a1",
        receipt: {
          site: { file: "f.tsi", loc: "1:1" },
          servedBy: "mock",
          attempts: 1,
          durationMs: 5,
          outcome: { ok: true, value: 1 },
          invocationId: "inv-1",
          spanPath: ["inv-1"],
          kind: "extract",
        },
      },
    });
    await service.ingest({
      ...envelope,
      seq: 4,
      kind: "invocationEnd",
      event: {
        invocationId: "inv-1",
        status: "ok",
        durationMs: 9,
        trace: { kind: "invocation", invocationId: "inv-1", fn: "triage", file: "f.tsi", spans: [] },
      },
    });

    const projects = (await (await app.request("/api/projects")).json()) as { projects: Array<{ name: string | null }> };
    expect(projects.projects[0]).toMatchObject({ name: "shop", traceCount: 1 });

    const records = (await (await app.request("/api/records?project=shop")).json()) as {
      records: Array<Record<string, unknown>>;
    };
    expect(records.records.map((r) => [r.kind, r.id, r.label])).toEqual([
      ["invocation", "inv-1", "triage(..)"],
      ["extract", "a1", "..`triage`"],
    ]);
    expect(records.records[0]).toMatchObject({ runId: "r", status: "ok", askCount: 1 });
    expect((await app.request("/api/records?noProject=1")).status).toBe(200);
    expect(((await (await app.request("/api/records?runId=nope")).json()) as { records: unknown[] }).records).toHaveLength(0);
    expect((await (await app.request("/api/records?limit=0")).json()) as { records: unknown[] }).toEqual({ records: [] });

    const detail = await app.request("/api/traces/inv-1");
    expect(detail.status).toBe(200);
    const trace = (await detail.json()) as { node: { id: string }; records: unknown[]; trace?: unknown };
    expect(trace.node.id).toBe("inv-1");
    expect(trace.records).toHaveLength(2);
    expect(trace.trace).toMatchObject({ fn: "triage" });
    expect((await app.request("/api/traces/nope")).status).toBe(404);
    expect((await app.request("/api/traces")).status).toBe(404);

    const ask = await app.request("/api/asks/a1");
    expect(ask.status).toBe(200);
    const askBody = (await ask.json()) as { events: unknown[]; attemptRows: unknown[]; invocationChain: unknown[]; kind: string };
    expect(askBody.events).toHaveLength(3);
    expect(askBody.attemptRows).toHaveLength(1);
    expect(askBody.invocationChain).toEqual([{ invocationId: "inv-1", fn: "triage", depth: 0 }]);
    expect(askBody.kind).toBe("extract");
    expect((await app.request("/api/asks/nope")).status).toBe(404);
  });

  it("serves definitions with stats and the definition detail", async () => {
    const { app } = setup();
    await app.request("/v1/ingest", { method: "POST", body: JSON.stringify(envelope) });
    const defs = (await (await app.request("/api/definitions?project=shop")).json()) as {
      definitions: Array<{ def: string; executions: number; instruction?: string }>;
    };
    expect(defs.definitions[0]).toMatchObject({ def: "d1".repeat(32), executions: 1, instruction: "triage" });
    const detail = await app.request(`/api/definitions/${"d1".repeat(32)}`);
    expect(detail.status).toBe(200);
    expect(((await detail.json()) as { asks: unknown[] }).asks).toHaveLength(1);
    expect((await app.request("/api/definitions/nope")).status).toBe(404);
    expect((await app.request("/api/definitions?project=x&noProject=1")).status).toBe(400);
  });

  it("narrows a definition's executions by the query string", async () => {
    const { app, service } = setup();
    const start = (askId: string, seq: number, at: number): NolaIngestEnvelope => ({
      ...envelope,
      seq,
      at,
      event: { ...(envelope.event as object), askId, invocationId: `inv-${askId}`, spanPath: [`inv-${askId}`] },
    });
    await service.ingest(start("a1", 0, 1000));
    await service.ingest(start("a2", 1, 2000));
    await service.ingest(start("a3", 2, 3000));
    const url = `/api/definitions/${"d1".repeat(32)}`;
    type Detail = { asks: Array<{ askId: string }>; matched: number; executions: number };
    const get = async (qs: string) => (await (await app.request(`${url}${qs}`)).json()) as Detail;

    const windowed = await get("?from=1500&to=3000&limit=1");
    expect(windowed.asks.map((a) => a.askId)).toEqual(["a3"]);
    expect(windowed).toMatchObject({ matched: 2, executions: 3 });
    expect((await get("?pid=1")).matched).toBe(3);
    expect((await get("?pid=2")).matched).toBe(0);
    expect((await get("?dmin=1")).matched).toBe(0); // all three are still running

    // a malformed bound is refused — ignoring it would silently answer a different question
    for (const qs of ["?from=abc", "?to=-1", "?dmin=", "?limit=0", "?limit=1.5"]) {
      const res = await app.request(`${url}${qs}`);
      expect(res.status, qs).toBe(400);
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe("invalid_query");
    }
  });

  it("rejects project= together with noProject=1", async () => {
    const { app } = setup();
    const res = await app.request("/api/records?project=x&noProject=1");
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("invalid_query");
  });

  it("DELETE /api/records clears everything and returns 204", async () => {
    const { app, service } = setup();
    await service.ingest(envelope);
    expect(((await (await app.request("/api/records")).json()) as { records: unknown[] }).records).toHaveLength(2);
    const res = await app.request("/api/records", { method: "DELETE" });
    expect(res.status).toBe(204);
    expect(((await (await app.request("/api/records")).json()) as { records: unknown[] }).records).toEqual([]);
    expect((await app.request("/api/asks/a1")).status).toBe(404);
  });

  it("retired /api/runs is gone", async () => {
    const { app } = setup();
    expect((await app.request("/api/runs")).status).toBe(404);
  });

  it("streams ingested envelopes over /api/events SSE", async () => {
    const { app, service } = setup();
    const res = await app.request("/api/events");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const reader = (res.body as ReadableStream<Uint8Array>).getReader();
    await service.ingest(envelope);
    const { value } = await reader.read();
    const text = new TextDecoder().decode(value);
    expect(text).toContain('"kind":"askStart"');
    await service.clear();
    expect(new TextDecoder().decode((await reader.read()).value)).toContain('"kind":"cleared"');
    await reader.cancel();
  });

  it("serves a placeholder page at /", async () => {
    const { app } = setup();
    const res = await app.request("/");
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("Nola Console");
  });
});
