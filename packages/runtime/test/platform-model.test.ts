import type { InferenceModel, NolaInferRequest, NolaInferResponse } from "@nola-lang/core";
import { NOLA_PROTOCOL as CORE_PROTOCOL, isPlatformModel, NolaProviderError } from "@nola-lang/core";
import { NOLA_PROTOCOL, NOLA_VERSION } from "@nola-lang/runtime";
import { afterEach, describe, expect, it, vi } from "vitest";
import { platformModel } from "../src/platform-model.js";
import { requestOf } from "./helpers/model.js";

/** A minimal InferRequest over the canonical model, mirroring what the ask boundary builds. */
const inferReq = () => ({ model: requestOf({ dialect: "model" }).payload as InferenceModel });

type FetchArgs = { url: string; init: RequestInit };

function fakeFetch(reply: (args: FetchArgs) => { status?: number; body: unknown; headers?: Record<string, string> }) {
  const calls: FetchArgs[] = [];
  const fn = (async (url: unknown, init: unknown) => {
    const args = { url: String(url), init: init as RequestInit };
    calls.push(args);
    const { status = 200, body, headers } = reply(args);
    return new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers });
  }) as typeof globalThis.fetch;
  return { fn, calls };
}

describe("platform model", () => {
  it("POSTs the NolaInferRequest envelope (the model under `intent`) to /v1/infer and returns the NolaInferResponse text", async () => {
    const reply: NolaInferResponse = { text: '"Evgen"' };
    const { fn, calls } = fakeFetch(() => ({ body: reply }));
    const p = platformModel({ apiKey: "k", fetch: fn });
    expect(p.name).toBe("nola");
    const model = requestOf({ instruction: "user name", params: { temperature: 0 }, dialect: "model" })
      .payload as InferenceModel;
    const { text, durationMs } = await p.infer({
      model,
      params: { temperature: 0 },
      trace: { askId: "ask-1", invocationId: "inv-1", spanPath: ["inv-0", "inv-1"] },
    });
    expect(text).toBe('"Evgen"');
    expect(typeof durationMs).toBe("number");

    expect(calls[0]?.url).toBe("https://api.nola.sh/v1/infer");
    expect(calls[0]?.init.method).toBe("POST");
    const headers = calls[0]?.init.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer k");
    expect(headers["content-type"]).toBe("application/json");
    // The wire type lives in @nola-lang/core so the platform repo shares it verbatim.
    const expected: NolaInferRequest = {
      protocol: NOLA_PROTOCOL,
      version: NOLA_VERSION,
      askId: "ask-1",
      invocationId: "inv-1",
      spanPath: ["inv-0", "inv-1"],
      intent: model as NolaInferRequest["intent"],
      params: { temperature: 0 },
    };
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual(expected);
    expect(NOLA_PROTOCOL).toBe(CORE_PROTOCOL);
  });

  it("is the platform model: infer() is the seam, so the runtime hands it the InferenceModel", () => {
    expect(isPlatformModel(platformModel({ apiKey: "k" }))).toBe(true);
  });

  it("omits trace and params when absent; honours baseUrl with a trailing slash", async () => {
    const { fn, calls } = fakeFetch(() => ({ body: { text: "1" } }));
    await platformModel({ apiKey: "k", fetch: fn, baseUrl: "http://localhost:8787/" }).infer(inferReq());
    expect(calls[0]?.url).toBe("http://localhost:8787/v1/infer");
    const body = JSON.parse(String(calls[0]?.init.body)) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(["intent", "protocol", "version"]);
  });

  it("reads the key lazily from NOLA_API_KEY (or apiKeyEnv) and fails definitively without one", async () => {
    const { fn } = fakeFetch(() => ({ body: { text: "1" } }));
    const saved = process.env.NOLA_API_KEY;
    delete process.env.NOLA_API_KEY;
    try {
      const err = await platformModel({ fetch: fn }).infer(inferReq()).then(() => { throw new Error("expected throw"); }, (e: unknown) => e);
      expect(err).toBeInstanceOf(NolaProviderError);
      expect((err as NolaProviderError).definitive).toBe(true);
      expect((err as Error).message).toContain("NOLA_API_KEY");
      process.env.MY_NOLA_KEY = "from-env";
      await expect(platformModel({ fetch: fn, apiKeyEnv: "MY_NOLA_KEY" }).infer(inferReq())).resolves.toEqual(expect.objectContaining({ text: "1" }));
    } finally {
      if (saved !== undefined) process.env.NOLA_API_KEY = saved;
      delete process.env.MY_NOLA_KEY;
    }
  });

  it("maps HTTP failures to NolaProviderError with status, Retry-After, and definitive on 401/403", async () => {
    const { fn: f429 } = fakeFetch(() => ({ status: 429, body: "slow down", headers: { "retry-after": "2" } }));
    const e429 = (await platformModel({ apiKey: "k", fetch: f429, retry: false }).infer(inferReq()).catch((e: unknown) => e)) as NolaProviderError;
    expect(e429).toBeInstanceOf(NolaProviderError);
    expect(e429.status).toBe(429);
    expect(e429.retryAfterMs).toBe(2000);
    expect(e429.definitive).not.toBe(true);

    const { fn: f401 } = fakeFetch(() => ({ status: 401, body: "bad key" }));
    const e401 = (await platformModel({ apiKey: "k", fetch: f401 }).infer(inferReq()).catch((e: unknown) => e)) as NolaProviderError;
    expect(e401.status).toBe(401);
    expect(e401.definitive).toBe(true);
    expect(e401.message).toContain("bad key");
  });

  it("rejects a reply without text", async () => {
    const { fn } = fakeFetch(() => ({ body: { value: 1 } }));
    await expect(platformModel({ apiKey: "k", fetch: fn, retry: false }).infer(inferReq())).rejects.toThrow(/no text/);
  });

  it("forwards the ask-site profile into the NolaInferRequest body, and omits it when absent", async () => {
    const { fn, calls } = fakeFetch(() => ({ body: { text: "1" } }));
    const p = platformModel({ apiKey: "k", fetch: fn });
    await p.infer({ ...inferReq(), profile: "fast" });
    expect(JSON.parse(String(calls[0]?.init.body)).profile).toBe("fast");
    await p.infer(inferReq());
    expect("profile" in JSON.parse(String(calls[1]?.init.body))).toBe(false);
  });

  it("sends no `model` when none is configured — Nola chooses — and the selector when given", async () => {
    const { fn, calls } = fakeFetch(() => ({ body: { text: "1" } }));
    await platformModel({ apiKey: "k", fetch: fn }).infer(inferReq());
    expect("model" in JSON.parse(String(calls[0]?.init.body))).toBe(false);

    await platformModel({ apiKey: "k", fetch: fn, model: "openai/gpt-5-mini" }).infer(inferReq());
    expect(JSON.parse(String(calls[1]?.init.body)).model).toBe("openai/gpt-5-mini");

    const bare = platformModel({ model: "workers-ai/@cf/openai/gpt-oss-120b" });
    expect(bare.name).toBe("nola");
  });

  it("honours NOLA_API_URL for the base URL (dev override), explicit baseUrl winning", async () => {
    const { fn, calls } = fakeFetch(() => ({ body: { text: "1" } }));
    const prev = process.env.NOLA_API_URL;
    process.env.NOLA_API_URL = "http://127.0.0.1:8787/";
    try {
      await platformModel({ apiKey: "k", fetch: fn }).infer(inferReq());
      expect(calls[0]?.url).toBe("http://127.0.0.1:8787/v1/infer");
      await platformModel({ apiKey: "k", fetch: fn, baseUrl: "http://localhost:1" }).infer(inferReq());
      expect(calls[1]?.url).toBe("http://localhost:1/v1/infer");
    } finally {
      if (prev === undefined) delete process.env.NOLA_API_URL;
      else process.env.NOLA_API_URL = prev;
    }
  });

  it("surfaces a coded server error VERBATIM with code, details and status — 402 quota_exceeded is definitive", async () => {
    const message =
      "Your 25 free Nola runs are complete.\n\n25 / 25 free runs used.\n\nAdd credits to continue:\n  nola account\n\nOr configure your own inference provider in nola.config.ts.";
    const { fn } = fakeFetch(() => ({
      status: 402,
      body: { error: { code: "quota_exceeded", message, details: { runsUsed: 25, runsLimit: 25 } } },
    }));
    const err = (await platformModel({ apiKey: "k", fetch: fn }).infer(inferReq()).catch((e: unknown) => e)) as NolaProviderError;
    expect(err).toBeInstanceOf(NolaProviderError);
    expect(err.message).toBe(message);
    expect(err.code).toBe("quota_exceeded");
    expect(err.details).toEqual({ runsUsed: 25, runsLimit: 25 });
    expect(err.status).toBe(402);
    expect(err.definitive).toBe(true);
  });

  it.each([
    [403, "model_not_allowed", true],
    [413, "request_too_large", true],
    [401, "unauthorized", true],
    [429, "rate_limited", false],
    [500, "internal", false],
  ])("status %i (%s) → definitive %s", async (status, code, definitive) => {
    const { fn } = fakeFetch(() => ({
      status,
      body: { error: { code, message: `m-${code}` } },
      headers: status === 429 ? { "retry-after": "7" } : {},
    }));
    const err = (await platformModel({ apiKey: "k", fetch: fn, retry: false }).infer(inferReq()).catch((e: unknown) => e)) as NolaProviderError;
    expect(err.code).toBe(code);
    expect(err.message).toBe(`m-${code}`);
    expect(err.definitive).toBe(definitive);
    if (status === 429) expect(err.retryAfterMs).toBe(7000);
  });

  it("keeps the generic message for a non-JSON error body", async () => {
    const { fn } = fakeFetch(() => ({ status: 502, body: "<html>bad gateway</html>" }));
    const err = (await platformModel({ apiKey: "k", fetch: fn, retry: false }).infer(inferReq()).catch((e: unknown) => e)) as NolaProviderError;
    expect(err.message).toMatch(/^Nola API request failed: 502/);
    expect(err.code).toBeUndefined();
    expect(err.definitive).toBe(false);
  });

  it("names the trial and the console in the missing-key message", async () => {
    const prev = process.env.NOLA_API_KEY;
    delete process.env.NOLA_API_KEY;
    try {
      const err = (await platformModel({ fetch: fakeFetch(() => ({ body: { text: "1" } })).fn })
        .infer(inferReq())
        .catch((e: unknown) => e)) as NolaProviderError;
      expect(err.message).toMatch(/NOLA_API_KEY/);
      expect(err.message).toMatch(/npm create nola/);
      expect(err.message).toMatch(/npx nola-lang key/);
      expect(err.message).not.toMatch(/npx nola init/);
      expect(err.message).toMatch(
        /bring your own model in nola.config.ts \(https:\/\/nola\.sh\/docs\/reference\/providers-api\/\)\./,
      );
      expect(err.message).not.toContain("https://nola.sh.");
      expect(err.definitive).toBe(true);
    } finally {
      if (prev !== undefined) process.env.NOLA_API_KEY = prev;
    }
  });

  describe("built-in transport retry", () => {
    it("retries a 500 and succeeds on the next attempt", async () => {
      let attempts = 0;
      const { fn, calls } = fakeFetch(() => (++attempts === 1 ? { status: 500, body: "boom" } : { body: { text: "ok" } }));
      const res = await platformModel({ apiKey: "k", fetch: fn, retry: { delayMs: 0 } }).infer(inferReq());
      expect(res.text).toBe("ok");
      expect(calls).toHaveLength(2);
    });

    it("does not retry a definitive 401", async () => {
      const { fn, calls } = fakeFetch(() => ({ status: 401, body: "no" }));
      await expect(platformModel({ apiKey: "k", fetch: fn, retry: { delayMs: 0 } }).infer(inferReq())).rejects.toThrow();
      expect(calls).toHaveLength(1);
    });

    it("retry: false disables retry entirely", async () => {
      const { fn, calls } = fakeFetch(() => ({ status: 500, body: "boom" }));
      await expect(platformModel({ apiKey: "k", fetch: fn, retry: false }).infer(inferReq())).rejects.toThrow();
      expect(calls).toHaveLength(1);
    });

    it("exhausts maxRetries then throws the last error", async () => {
      const { fn, calls } = fakeFetch(() => ({ status: 503, body: "boom" }));
      await expect(
        platformModel({ apiKey: "k", fetch: fn, retry: { maxRetries: 2, delayMs: 0 } }).infer(inferReq()),
      ).rejects.toThrow();
      expect(calls).toHaveLength(3);
    });

    it("honours Retry-After up to maxDelayMs; maxDelayMs 0 ignores the header", async () => {
      let attempts = 0;
      const { fn, calls } = fakeFetch(() =>
        ++attempts === 1 ? { status: 429, body: "slow", headers: { "retry-after": "9" } } : { body: { text: "ok" } },
      );
      const started = Date.now();
      const res = await platformModel({ apiKey: "k", fetch: fn, retry: { delayMs: 0, maxDelayMs: 0 } }).infer(inferReq());
      expect(res.text).toBe("ok");
      expect(calls).toHaveLength(2);
      expect(Date.now() - started).toBeLessThan(5000);
    });
  });

  describe("low-runs notice", () => {
    afterEach(() => vi.restoreAllMocks());

    const withUsage = (used: number, limit: number) =>
      fakeFetch(() => ({
        body: { text: "1" },
        headers: { "x-nola-runs-used": String(used), "x-nola-runs-limit": String(limit) },
      })).fn;

    it("prints one stderr line when 5 or fewer runs remain, silent above that", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      await platformModel({ apiKey: "k", fetch: withUsage(19, 25) }).infer(inferReq());
      expect(warn).not.toHaveBeenCalled();
      await platformModel({ apiKey: "k", fetch: withUsage(20, 25) }).infer(inferReq());
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0]?.[0]).toBe("Nola free usage: 20 / 25 runs — 5 left. Run `nola account` to add credits.");
      await platformModel({ apiKey: "k", fetch: withUsage(25, 25) }).infer(inferReq());
      expect(warn.mock.calls[1]?.[0]).toBe("Nola free usage: 25 / 25 runs — 0 left. Run `nola account` to add credits.");
    });

    it("prints a given count once per provider instance", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const p = platformModel({ apiKey: "k", fetch: withUsage(23, 25) });
      await p.infer(inferReq());
      await p.infer(inferReq());
      expect(warn).toHaveBeenCalledTimes(1);
    });

    it("is silent without the headers (BYOK / stubs)", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      await platformModel({ apiKey: "k", fetch: fakeFetch(() => ({ body: { text: "1" } })).fn }).infer(inferReq());
      expect(warn).not.toHaveBeenCalled();
    });

    it("is silent in paid mode: the run counter still arrives, but x-nola-balance-micro says credit is being spent", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const paid = fakeFetch(() => ({
        body: { text: "1" },
        headers: { "x-nola-runs-used": "25", "x-nola-runs-limit": "25", "x-nola-balance-micro": "4900000" },
      })).fn;
      await platformModel({ apiKey: "k", fetch: paid }).infer(inferReq());
      expect(warn).not.toHaveBeenCalled();
    });
  });

  describe("platform contract", () => {
    afterEach(() => vi.restoreAllMocks());

    const modelOf = () => requestOf({ dialect: "model" }).payload as InferenceModel;

    it("is a PlatformModel: brand gate, infer() consumes the model", async () => {
      const { fn, calls } = fakeFetch(() => ({ body: { text: "ok" } }));
      const p = platformModel({ apiKey: "k", fetch: fn });
      expect(isPlatformModel(p)).toBe(true);
      expect(p.name).toBe("nola");
      const res = await p.infer({ model: modelOf(), profile: "fast" });
      expect(res.text).toBe("ok");
      const body = JSON.parse(String(calls[0]?.init.body)) as Record<string, unknown>;
      expect(body.intent).toBeDefined();
      expect(body.profile).toBe("fast");
    });

    it("forwards the project onto the NolaInferRequest body, omitting it when absent", async () => {
      const { fn, calls } = fakeFetch(() => ({ body: { text: "1" } }));
      const p = platformModel({ apiKey: "k", fetch: fn });
      await p.infer({ ...inferReq(), project: "my-app" });
      expect(JSON.parse(String(calls[0]?.init.body)).project).toBe("my-app");
      await p.infer(inferReq());
      expect("project" in JSON.parse(String(calls[1]?.init.body))).toBe(false);
    });

  });
});

describe("platform model — protocol 1 wire compatibility", () => {
  it("sends a call intent as intent: \"extract\" without callee/hint — the deployed validator accepts only extract", async () => {
    const { fn, calls } = fakeFetch(() => ({ body: { text: "{}" } satisfies NolaInferResponse }));
    const p = platformModel({ apiKey: "k", fetch: fn });
    const model: InferenceModel = {
      intent: "call",
      input: { instruction: 'Generate the arguments for calling the function "notify". urgently', callee: "notify", hint: "urgently" },
      output: { syntax: "json", schema: { type: "object" } },
    };
    await p.infer({ model });
    const sent = (JSON.parse(String(calls[0]?.init.body)) as NolaInferRequest).intent;
    expect(sent.intent).toBe("extract");
    expect(sent.input).toEqual({ instruction: 'Generate the arguments for calling the function "notify". urgently' });
    expect(sent.output).toEqual(model.output);
  });

  it("sends an extract model untouched", async () => {
    const { fn, calls } = fakeFetch(() => ({ body: { text: '"x"' } satisfies NolaInferResponse }));
    const p = platformModel({ apiKey: "k", fetch: fn });
    const { model } = inferReq();
    await p.infer({ model });
    expect((JSON.parse(String(calls[0]?.init.body)) as NolaInferRequest).intent).toEqual(model);
  });
});
