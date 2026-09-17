import type { NolaCapabilitiesResponse, NolaErrorResponse, NolaIngestEnvelope } from "@nola-lang/core";
import { NOLA_INGEST_KINDS, NOLA_INGEST_VERSION, NOLA_PROTOCOL } from "@nola-lang/core";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { ConsoleService } from "../core/service.js";
import type { DefinitionAsksQuery } from "../storage/types.js";
import { loadUiAssets } from "./static.js";

const isClientRoute = (pathname: string): boolean =>
  !pathname.startsWith("/api/") && !pathname.startsWith("/v1/") && !/\.[a-z0-9]+$/i.test(pathname);

const invalid = (message: string): NolaErrorResponse => ({ error: { code: "invalid_envelope", message } });

function isIngestEnvelope(body: unknown): body is NolaIngestEnvelope {
  const e = body as Partial<NolaIngestEnvelope> | null;
  return (
    !!e &&
    typeof e === "object" &&
    e.v === NOLA_INGEST_VERSION &&
    typeof e.runId === "string" &&
    typeof e.pid === "number" &&
    typeof e.seq === "number" &&
    typeof e.at === "number" &&
    (NOLA_INGEST_KINDS as readonly string[]).includes(e.kind as string)
  );
}

/**
 * The executions filter of `GET /api/definitions/:def`. A malformed bound is refused (the message
 * is returned) — ignoring it would silently answer a different question than the one asked.
 */
function parseDefinitionAsksQuery(param: (name: string) => string | undefined): DefinitionAsksQuery | string {
  const query: DefinitionAsksQuery = {};
  for (const key of ["from", "to", "dmin", "dmax", "pid", "limit"] as const) {
    const raw = param(key);
    if (raw === undefined) continue;
    const n = raw.trim() === "" ? Number.NaN : Number(raw);
    const valid = key === "limit" ? Number.isInteger(n) && n > 0 : Number.isFinite(n) && n >= 0;
    if (!valid) return `${key} must be a ${key === "limit" ? "positive integer" : "non-negative number"}`;
    query[key] = n;
  }
  return query;
}

/** Thin HTTP adapter over ConsoleService — no domain logic in handlers (console design §13). */
export function createApp(service: ConsoleService, opts: { uiDir?: string } = {}): Hono {
  const app = new Hono();
  const assets = opts.uiDir !== undefined ? loadUiAssets(opts.uiDir) : undefined;

  app.get("/v1/capabilities", (c) => {
    // Phase 1 observes but does not serve inference; the phase-2 gateway flips `infer` on.
    const capabilities: NolaCapabilitiesResponse = { protocol: NOLA_PROTOCOL, infer: false, ingest: true };
    return c.json(capabilities);
  });

  app.post("/v1/ingest", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json(invalid("body is not JSON"), 400);
    }
    if (!isIngestEnvelope(body)) return c.json(invalid("body is not a NolaIngestEnvelope"), 400);
    await service.ingest(body);
    return c.body(null, 204);
  });

  app.get("/api/projects", async (c) => c.json({ projects: await service.listProjects() }));

  app.get("/api/records", async (c) => {
    const project = c.req.query("project");
    const noProject = c.req.query("noProject") === "1";
    if (project !== undefined && noProject)
      return c.json({ error: { code: "invalid_query", message: "project and noProject are mutually exclusive" } }, 400);
    const runId = c.req.query("runId");
    const limitRaw = c.req.query("limit");
    const limit = limitRaw !== undefined ? Number(limitRaw) : undefined;
    return c.json({
      records: await service.listRecords({
        ...(project !== undefined ? { project } : {}),
        ...(noProject ? { noProject } : {}),
        ...(runId !== undefined ? { runId } : {}),
        ...(limit !== undefined && Number.isFinite(limit) ? { limit } : {}),
      }),
    });
  });

  app.delete("/api/records", async (c) => {
    await service.clear();
    return c.body(null, 204);
  });

  app.get("/api/traces/:id", async (c) => {
    const trace = await service.getTrace(c.req.param("id"));
    if (!trace) return c.json({ error: { code: "not_found", message: "unknown trace" } }, 404);
    return c.json(trace);
  });

  app.get("/api/asks/:id", async (c) => {
    const ask = await service.getAsk(c.req.param("id"));
    if (!ask) return c.json({ error: { code: "not_found", message: "unknown ask" } }, 404);
    return c.json(ask);
  });

  app.get("/api/definitions", async (c) => {
    const project = c.req.query("project");
    const noProject = c.req.query("noProject") === "1";
    if (project !== undefined && noProject)
      return c.json({ error: { code: "invalid_query", message: "project and noProject are mutually exclusive" } }, 400);
    return c.json({
      definitions: await service.listDefinitions({
        ...(project !== undefined ? { project } : {}),
        ...(noProject ? { noProject } : {}),
      }),
    });
  });

  app.get("/api/definitions/:def", async (c) => {
    const query = parseDefinitionAsksQuery((name) => c.req.query(name));
    if (typeof query === "string") return c.json({ error: { code: "invalid_query", message: query } }, 400);
    const definition = await service.getDefinition(c.req.param("def"), query);
    if (!definition) return c.json({ error: { code: "not_found", message: "unknown definition" } }, 404);
    return c.json(definition);
  });

  app.get("/api/events", (c) =>
    streamSSE(c, async (stream) => {
      const unsubscribe = service.onEvent((notice) => {
        void stream.writeSSE({ data: JSON.stringify(notice) });
      });
      stream.onAbort(() => unsubscribe());
      // Hold the stream open until the client goes away; heartbeat comments keep proxies from timing it out.
      while (!stream.aborted) {
        await stream.sleep(15_000);
        if (!stream.aborted) await stream.writeSSE({ event: "ping", data: "" });
      }
    }),
  );

  if (assets) {
    const serveAsset = (path: string): Response | undefined => {
      const asset = assets.get(path);
      if (!asset) return undefined;
      return new Response(asset.body, { headers: { "content-type": asset.type } });
    };
    // Exact matches against the frozen startup map only — no fs at request time,
    // and the API routes above win by registration order. An extension-less path
    // outside /api and /v1 is a client-side route (the UI is a react-router SPA):
    // it gets index.html and the router takes it from there.
    app.get("*", (c) => {
      const pathname = new URL(c.req.url).pathname;
      const asset = serveAsset(pathname);
      if (asset) return asset;
      if (isClientRoute(pathname)) return serveAsset("/") ?? c.notFound();
      return c.notFound();
    });
  } else {
    app.get("/", (c) =>
      c.html(
        `<!doctype html><meta charset="utf-8"><title>Nola Console</title><body style="font-family:system-ui;margin:3rem"><h1>Nola Console</h1><p>The trace UI ships in the next release. The API is live: <code>GET /api/traces</code>, <code>GET /api/traces/:id</code>, <code>GET /api/events</code> (SSE).</p></body>`,
      ),
    );
  }

  return app;
}
