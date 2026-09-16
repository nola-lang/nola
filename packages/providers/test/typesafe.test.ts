import type { JsonSchema } from "@nola-lang/core";
import { NolaProviderError, SYSTEM_PREAMBLE } from "@nola-lang/core";
import { describe, expect, it } from "vitest";
import { typesafe } from "../src/typesafe.js";
import { requestOf } from "./helpers/model.js";

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

const answersReply = (answers: Record<string, unknown>) => ({
  body: { model: "jev-latest", answers, usage: { input_tokens: 10, output_tokens: 2 } },
});

const bodyOf = (call: FetchArgs | undefined) =>
  JSON.parse(String(call?.init.body)) as { model: string; state: string; questions: Record<string, unknown> };

const triage: JsonSchema = {
  type: "object",
  properties: {
    department: { type: "string", enum: ["billing", "shipping"], description: "Which team owns this?" },
    urgent: { type: "boolean" },
    priority: { anyOf: [{ const: 1 }, { const: 2 }] },
  },
  required: ["department", "urgent"],
  additionalProperties: false,
};

describe("typesafe provider — wire", () => {
  it("posts to /v1/systemone with bearer auth and the default model", async () => {
    const { fn, calls } = fakeFetch(() => answersReply({ value: { type: "noul", noul: 0.9 } }));
    const p = typesafe({ apiKey: "k", fetch: fn });
    expect(p.name).toBe("typesafe");
    const { text } = await p.complete(requestOf({ schema: { type: "boolean" } }));
    expect(text).toBe("true");
    expect(calls[0]?.url).toBe("https://api.typesafe.ai/v1/systemone");
    const headers = new Headers(calls[0]?.init.headers);
    expect(headers.get("authorization")).toBe("Bearer k");
    expect(headers.get("content-type")).toBe("application/json");
    expect(calls[0]?.init.method).toBe("POST");
    expect(bodyOf(calls[0]).model).toBe("jev-latest");
  });

  it("a bare string is the model; baseUrl trailing slash is trimmed", async () => {
    const { fn, calls } = fakeFetch(() => answersReply({ value: { type: "noul", noul: 0.1 } }));
    await typesafe({ apiKey: "k", fetch: fn, model: "jev-2", baseUrl: "https://example.test/" }).complete(
      requestOf({ schema: { type: "boolean" } }),
    );
    expect(calls[0]?.url).toBe("https://example.test/v1/systemone");
    expect(bodyOf(calls[0]).model).toBe("jev-2");
    // the string shorthand has no fetch slot, so only its name is checked here; the surface test pins the model it sets
    expect(typesafe("jev-3").name).toBe("typesafe");
  });

  it("state is the system text and the first user turn verbatim; the questions are the plan", async () => {
    const { fn, calls } = fakeFetch(() =>
      answersReply({
        department: { type: "choice", choice: "billing", probabilities: { billing: 0.8, shipping: 0.2 }, confidence: 0.8 },
        urgent: { type: "noul", noul: 0.7 },
        priority: { type: "choice", choice: "2", probabilities: { "1": 0.3, "2": 0.7 }, confidence: 0.7 },
      }),
    );
    const req = requestOf({ system: "house rules", instruction: "Triage this ticket", schema: triage });
    const { text } = await typesafe({ apiKey: "k", fetch: fn }).complete(req);
    expect(JSON.parse(text)).toEqual({ department: "billing", urgent: true, priority: 2 });
    const body = bodyOf(calls[0]);
    expect(body.state).toBe(`${req.payload.system}\n\n${req.payload.messages[0]?.content}`);
    expect(body.state).toContain(SYSTEM_PREAMBLE);
    expect(body.state).toContain("house rules");
    expect(body.state).toContain("Triage this ticket");
    expect(body.questions).toEqual({
      department: { type: "choice", instructions: "Which team owns this?", criteria: { billing: "billing", shipping: "shipping" } },
      urgent: { type: "noul", instructions: 'Determine "urgent".' },
      priority: { type: "choice", instructions: 'Determine "priority".', criteria: { "1": "1", "2": "2" } },
    });
  });

  it("a correction turn is ignored: state is still the first user turn", async () => {
    const { fn, calls } = fakeFetch(() => answersReply({ value: { type: "noul", noul: 0.9 } }));
    const req = requestOf({ schema: { type: "boolean" }, correction: { response: "bad", error: "oops" } });
    await typesafe({ apiKey: "k", fetch: fn }).complete(req);
    expect(req.payload.messages).toHaveLength(3);
    expect(bodyOf(calls[0]).state).not.toContain("oops");
    expect(bodyOf(calls[0]).state).toContain(req.payload.messages[0]?.content ?? "!");
  });

  it("forwards the abort signal", async () => {
    let seen: AbortSignal | null | undefined;
    const fn = (async (_url: unknown, init: unknown) => {
      seen = (init as RequestInit).signal;
      return new Response(JSON.stringify({ answers: { value: { type: "noul", noul: 1 } } }));
    }) as typeof globalThis.fetch;
    const controller = new AbortController();
    await typesafe({ apiKey: "k", fetch: fn }).complete({ ...requestOf({ schema: { type: "boolean" } }), signal: controller.signal });
    expect(seen).toBe(controller.signal);
  });
});

describe("typesafe provider — keys", () => {
  it("reads the key from a custom apiKeyEnv", async () => {
    process.env.NOLA_TEST_TS_KEY = "k-123";
    try {
      const { fn, calls } = fakeFetch(() => answersReply({ value: { type: "noul", noul: 1 } }));
      await typesafe({ apiKeyEnv: "NOLA_TEST_TS_KEY", fetch: fn }).complete(requestOf({ schema: { type: "boolean" } }));
      expect(new Headers(calls[0]?.init.headers).get("authorization")).toBe("Bearer k-123");
    } finally {
      delete process.env.NOLA_TEST_TS_KEY;
    }
  });

  it("missing key: names the env var, points at nola.config.ts, is definitive, and never fetches", async () => {
    delete process.env.NOLA_TEST_TS_MISSING;
    const { fn, calls } = fakeFetch(() => answersReply({}));
    const p = typesafe({ apiKeyEnv: "NOLA_TEST_TS_MISSING", fetch: fn });
    const err = (await p.complete(requestOf({ schema: { type: "boolean" } })).catch((e: unknown) => e)) as NolaProviderError;
    expect(err).toBeInstanceOf(NolaProviderError);
    expect(err.message).toMatch(/NOLA_TEST_TS_MISSING/);
    expect(err.message).toMatch(/nola\.config\.ts/);
    expect(err.message).toMatch(/typesafe\(\{ apiKeyEnv/);
    expect(err.definitive).toBe(true);
    expect(calls).toHaveLength(0);
  });
});

describe("typesafe provider — errors", () => {
  it("an unsupported output type fails definitively before any fetch, naming the path", async () => {
    const { fn, calls } = fakeFetch(() => answersReply({}));
    const p = typesafe({ apiKey: "k", fetch: fn });
    const err = (await p.complete(requestOf({ schema: { type: "string" } })).catch((e: unknown) => e)) as NolaProviderError;
    expect(err).toBeInstanceOf(NolaProviderError);
    expect(err.definitive).toBe(true);
    expect(err.message).toBe(
      "TypeSafe cannot serve this ask: the output type is a free-form string; typesafe() serves only literal unions and booleans",
    );
    expect(calls).toHaveLength(0);
  });

  it("free text (no schema) is unsupported too", async () => {
    const { fn, calls } = fakeFetch(() => answersReply({}));
    const err = (await typesafe({ apiKey: "k", fetch: fn })
      .complete(requestOf({ schema: null }))
      .catch((e: unknown) => e)) as NolaProviderError;
    expect(err.definitive).toBe(true);
    expect(err.message).toMatch(/no output schema/);
    expect(calls).toHaveLength(0);
  });

  it("non-2xx carries status, the body excerpt, and Retry-After", async () => {
    const { fn } = fakeFetch(() => ({ status: 429, body: { error: "slow down" }, headers: { "retry-after": "2" } }));
    const err = (await typesafe({ apiKey: "k", fetch: fn })
      .complete(requestOf({ schema: { type: "boolean" } }))
      .catch((e: unknown) => e)) as NolaProviderError;
    expect(err).toBeInstanceOf(NolaProviderError);
    expect(err.status).toBe(429);
    expect(err.retryAfterMs).toBe(2000);
    expect(err.definitive).toBeUndefined();
    expect(err.message).toMatch(/^TypeSafe request failed: 429 /);
    expect(err.message).toContain("slow down");
  });

  it("a 2xx missing an answer is definitive", async () => {
    const { fn } = fakeFetch(() => answersReply({}));
    const err = (await typesafe({ apiKey: "k", fetch: fn })
      .complete(requestOf({ schema: { type: "boolean" } }))
      .catch((e: unknown) => e)) as NolaProviderError;
    expect(err).toBeInstanceOf(NolaProviderError);
    expect(err.definitive).toBe(true);
    expect(err.message).toBe('TypeSafe reply is malformed: answer "value" is missing from the reply');
  });

  it("a 2xx choosing a foreign label is definitive", async () => {
    const { fn } = fakeFetch(() => answersReply({ value: { type: "choice", choice: "nope" } }));
    const err = (await typesafe({ apiKey: "k", fetch: fn })
      .complete(requestOf({ schema: { type: "string", enum: ["a", "b"] } }))
      .catch((e: unknown) => e)) as NolaProviderError;
    expect(err.definitive).toBe(true);
    expect(err.message).toBe('TypeSafe reply is malformed: answer "value" chose "nope", which is not one of the options sent');
  });

  it("a 2xx with no answers object is definitive", async () => {
    const { fn } = fakeFetch(() => ({ body: { model: "jev-latest" } }));
    const err = (await typesafe({ apiKey: "k", fetch: fn })
      .complete(requestOf({ schema: { type: "boolean" } }))
      .catch((e: unknown) => e)) as NolaProviderError;
    expect(err.definitive).toBe(true);
    expect(err.message).toBe("TypeSafe reply is malformed: no answers object");
  });

  it("a non-JSON 2xx body is definitive", async () => {
    const { fn } = fakeFetch(() => ({ body: "<html>" }));
    const err = (await typesafe({ apiKey: "k", fetch: fn })
      .complete(requestOf({ schema: { type: "boolean" } }))
      .catch((e: unknown) => e)) as NolaProviderError;
    expect(err.definitive).toBe(true);
    expect(err.message).toMatch(/^TypeSafe reply is not JSON/);
  });
});
