import { createServer, type Server } from "node:http";
import type { NolaIngestEnvelope } from "@nola-lang/core";
import { nola, nolaRuntime, TERMINAL_TRACE, TRACER_HOOK, terminalTrace } from "@nola-lang/runtime";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveNolaConfig } from "../src/config.js";

type Call = { url: string; init: RequestInit };
function fakeFetch(reply: (c: Call) => { status?: number; body?: unknown }) {
  const calls: Call[] = [];
  const fn = (async (url: unknown, init: unknown) => {
    const c = { url: String(url), init: init as RequestInit };
    calls.push(c);
    const { status = 200, body = "" } = reply(c);
    return new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
  }) as typeof fetch;
  return { fn, calls };
}
const mock = { name: "mock", complete: async () => ({ text: "" }) };
const askStart = { askId: "a1", site: { file: "f.tsi", loc: "1:1" }, provider: "mock" } as never;

describe("nola.tracer() — a NolaTelemetry that posts envelopes", () => {
  afterEach(() => vi.restoreAllMocks());

  it("posts one kind-discriminated envelope per event, seq-ordered under one runId, keyless on loopback", async () => {
    const prev = process.env.NOLA_API_KEY;
    delete process.env.NOLA_API_KEY;
    try {
      const { fn, calls } = fakeFetch(() => ({ status: 204 }));
      const hook = nola.tracer({ baseUrl: "http://localhost:4141", fetch: fn });
      expect(hook.name).toBe("nola:tracer");
      hook.onAskStart?.(askStart);
      hook.onAskEnd?.({ askId: "a1", receipt: { askId: "a1", fingerprint: "a".repeat(64) } } as never);
      await vi.waitFor(() => expect(calls).toHaveLength(2));
      expect(calls[0]?.url).toBe("http://localhost:4141/v1/ingest");
      expect((calls[0]?.init.headers as Record<string, string>).authorization).toBeUndefined();
      const [first, second] = calls.map((c) => JSON.parse(String(c.init.body)) as NolaIngestEnvelope);
      expect(first?.kind).toBe("askStart");
      expect(first?.seq).toBe(0);
      expect(first?.pid).toBe(process.pid);
      expect(second?.kind).toBe("askEnd");
      expect(second?.seq).toBe(1);
      expect(second?.runId).toBe(first?.runId);
    } finally {
      if (prev !== undefined) process.env.NOLA_API_KEY = prev;
    }
  });

  it("accepts a bare URL; redacts content but preserves fingerprint and def", async () => {
    const { fn, calls } = fakeFetch(() => ({ status: 204 }));
    vi.stubGlobal("fetch", fn);
    try {
      const hook = nola.tracer("http://localhost:4141");
      const def = "d".repeat(64);
      hook.onAskStart?.({ ...askStart, def, instruction: `key ${"c".repeat(40)} end` } as never);
      hook.onAskEnd?.({ askId: "a1", receipt: { askId: "a1", def, fingerprint: "b".repeat(64) } } as never);
      await vi.waitFor(() => expect(calls).toHaveLength(2));
      const start = JSON.parse(String(calls[0]?.init.body)) as { event: { def: string; instruction: string } };
      expect(start.event.def).toBe(def);
      expect(start.event.instruction).not.toContain("c".repeat(40));
      const end = JSON.parse(String(calls[1]?.init.body)) as { event: { receipt: { def: string; fingerprint: string } } };
      expect(end.event.receipt.def).toBe(def);
      expect(end.event.receipt.fingerprint).toBe("b".repeat(64));
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("stamps the latched project on every envelope when the config has one", async () => {
    const { fn, calls } = fakeFetch(() => ({ status: 204 }));
    const { nolaRuntime } = await import("@nola-lang/runtime");
    nolaRuntime.reset();
    nolaRuntime.configure({ model: mock, project: "my-app" });
    try {
      const hook = nola.tracer({ baseUrl: "http://localhost:4141", fetch: fn });
      hook.onAskStart?.(askStart);
      await vi.waitFor(() => expect(calls).toHaveLength(1));
      expect((JSON.parse(String(calls[0]?.init.body)) as NolaIngestEnvelope).project).toBe("my-app");
    } finally {
      nolaRuntime.reset();
    }
  });

  it("never throws into the ask path: unreachable console warns once, keeps trying", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    let sends = 0;
    const failing = (async () => {
      sends++;
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;
    const hook = nola.tracer({ baseUrl: "http://localhost:4141", fetch: failing });
    hook.onAskStart?.(askStart);
    hook.onAskStart?.(askStart);
    await vi.waitFor(() => expect(sends).toBe(2));
    await vi.waitFor(() => expect(warn).toHaveBeenCalledTimes(1));
    expect(String(warn.mock.calls[0]?.[0])).toMatch(/console unreachable/);
  });

  it("notices a non-loopback destination once; a user tracer is never gated on capabilities", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { fn, calls } = fakeFetch(() => ({ status: 204 }));
    const hook = nola.tracer({ baseUrl: "https://traces.example.com", fetch: fn });
    hook.onAskStart?.(askStart);
    hook.onAskStart?.(askStart);
    await vi.waitFor(() => expect(calls).toHaveLength(2));
    expect(calls.every((c) => c.url.endsWith("/v1/ingest"))).toBe(true); // no /v1/capabilities probe
    expect(warn.mock.calls.filter((c) => String(c[0]).includes("traces →"))).toHaveLength(1);
  });

  it("an empty string counts as no target — the default URL rule applies", () => {
    vi.stubEnv("NOLA_API_URL", "http://localhost:8787");
    expect(nola.tracer("").name).toBe(TRACER_HOOK);
    vi.unstubAllEnvs();
  });
});

describe("NOLA_TRACING_URL — append the default tracer", () => {
  const env = process.env.NOLA_TRACING_URL;
  afterEach(() => {
    if (env === undefined) delete process.env.NOLA_TRACING_URL;
    else process.env.NOLA_TRACING_URL = env;
    vi.restoreAllMocks();
  });

  it("appends nola.tracer(url) after the default terminal sink when the config lists no tracer", () => {
    process.env.NOLA_TRACING_URL = "http://localhost:4141";
    const c = resolveNolaConfig({ model: mock });
    expect(c.telemetry.map((h) => h.name)).toEqual([TERMINAL_TRACE, "nola:tracer"]);
  });

  it("appends after the listed observers, keeping their order", () => {
    process.env.NOLA_TRACING_URL = "http://localhost:5555";
    const mine = { name: "mine", onAskEnd: () => {} };
    const c = resolveNolaConfig({ model: mock, telemetry: [mine, terminalTrace()] });
    expect(c.telemetry.map((h) => h.name)).toEqual(["mine", TERMINAL_TRACE, "nola:tracer"]);
  });

  it("is ignored with one notice when the config lists a tracer itself", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    process.env.NOLA_TRACING_URL = "http://localhost:5555";
    const c = resolveNolaConfig({ model: mock, telemetry: [nola.tracer("http://localhost:4141")] });
    expect(c.telemetry).toHaveLength(1);
    expect(c.telemetry[0]?.name).toBe("nola:tracer");
    expect(warn.mock.calls.some(([m]) => String(m).includes("NOLA_TRACING_URL"))).toBe(true);
  });

  it("re-resolving a resolved config does not append twice and stays silent", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    process.env.NOLA_TRACING_URL = "http://localhost:4141";
    const once = resolveNolaConfig({ model: mock });
    const twice = resolveNolaConfig(once);
    expect(twice.telemetry).toHaveLength(2);
    expect(twice.telemetry[1]).toBe(once.telemetry[1]);
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("NolaRuntime wiring", () => {
  it("emitEvent reaches a live console over HTTP when NOLA_TRACING_URL is set", async () => {
    const received: NolaIngestEnvelope[] = [];
    let resolveNext: (() => void) | undefined;
    const server: Server = createServer((req, res) => {
      let body = "";
      req.on("data", (c) => {
        body += c;
      });
      req.on("end", () => {
        received.push(JSON.parse(body) as NolaIngestEnvelope);
        res.writeHead(204).end();
        resolveNext?.();
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("no port");
    const prev = process.env.NOLA_TRACING_URL;
    process.env.NOLA_TRACING_URL = `http://127.0.0.1:${address.port}`;
    try {
      nolaRuntime.reset();
      nolaRuntime.configure({ model: mock });
      const arrived = new Promise<void>((r) => {
        resolveNext = r;
      });
      nolaRuntime
        .current()
        .emitEvent("onAskStart", { askId: "w1", site: { file: "f.tsi", loc: "1:1" }, provider: "mock" } as never);
      await arrived;
      expect(received.at(-1)?.kind).toBe("askStart");
    } finally {
      if (prev === undefined) delete process.env.NOLA_TRACING_URL;
      else process.env.NOLA_TRACING_URL = prev;
      nolaRuntime.reset();
      await new Promise<void>((r) => server.close(() => r()));
    }
  });
});

describe("nola.tracer() — invocation events", () => {
  it("maps onInvocationStart to the invocationStart kind", async () => {
    const { fn, calls } = fakeFetch(() => ({ status: 204 }));
    const hook = nola.tracer({ baseUrl: "http://localhost:4141", fetch: fn });
    hook.onInvocationStart?.({ invocationId: "i1", spanPath: ["i1"], fn: "triage", file: "f.tsi", detached: false });
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    const envelope = JSON.parse(String(calls[0]?.init.body)) as NolaIngestEnvelope;
    expect(envelope.kind).toBe("invocationStart");
    expect(envelope.event).toMatchObject({ fn: "triage" });
  });
});
