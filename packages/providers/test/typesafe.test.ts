import type { InferenceScope, InferRequest, JsonSchema } from "@nola-lang/core";
import { isDecisionModel, isInferModel, NolaProviderError } from "@nola-lang/core";
import { describe, expect, it } from "vitest";
import { typesafe } from "../src/typesafe.js";
import { modelOf } from "./helpers/model.js";

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

type Body = { model: string; state: unknown; questions: Record<string, unknown> };
const bodyOf = (call: FetchArgs | undefined) => JSON.parse(String(call?.init.body)) as Body;
const req = (init: Parameters<typeof modelOf>[0], extra: Partial<InferRequest> = {}): InferRequest => ({
  model: modelOf(init),
  ...extra,
});
const bool = { type: "boolean" } as const;

const provider = (options: Parameters<typeof typesafe>[0]) => {
  const p = typesafe(options);
  if (!isInferModel(p)) throw new Error("typesafe is an infer-dialect model");
  return p;
};

const unit: JsonSchema = { type: "number", minimum: 0, maximum: 1 };
const triage: JsonSchema = {
  type: "object",
  properties: {
    department: { type: "string", enum: ["billing", "shipping"], description: "Which team owns this?" },
    urgent: { type: "boolean" },
    priority: { anyOf: [{ const: 1 }, { const: 2 }] },
    mood: {
      type: "object",
      properties: {
        score: { type: "number", minimum: 0, maximum: 1 },
        probabilities: { type: "array", items: unit, minItems: 2, maxItems: 2 },
        levels: { type: "array", prefixItems: [{ const: "Calm" }, { const: "Angry" }], items: false, minItems: 2, maxItems: 2 },
        confidence: unit,
      },
      required: ["score", "probabilities"],
      additionalProperties: false,
      description: "How frustrated?",
      "x-nola-decision": { kind: "scale", levels: ["Calm", "Angry"] },
    },
  },
  required: ["department", "urgent"],
  additionalProperties: false,
};
const scope: InferenceScope = {
  fn: "triage",
  instruction: "You triage tickets.",
  args: [{ name: "ticket", contextual: true, value: "charged twice" }],
};

describe("typesafe provider — wire", () => {
  it("is an infer-dialect decision model; posts to /v1/systemone with bearer auth and the default model", async () => {
    const { fn, calls } = fakeFetch(() => answersReply({ value: { type: "noul", noul: 0.9 } }));
    const p = typesafe({ apiKey: "k", fetch: fn });
    expect(p.name).toBe("typesafe");
    expect(isInferModel(p)).toBe(true);
    expect(isDecisionModel(p)).toBe(true);
    const { text } = await provider({ apiKey: "k", fetch: fn }).infer(req({ schema: bool }));
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
    await provider({ apiKey: "k", fetch: fn, model: "jev-2", baseUrl: "https://example.test/" }).infer(req({ schema: bool }));
    expect(calls[0]?.url).toBe("https://example.test/v1/systemone");
    expect(bodyOf(calls[0]).model).toBe("jev-2");
    expect(typesafe("jev-3").name).toBe("typesafe");
  });

  it("state is the contextual values; questions carry the structured instructions and every kind decodes", async () => {
    const { fn, calls } = fakeFetch(() =>
      answersReply({
        department: { type: "choice", choice: "billing", probabilities: { billing: 0.8, shipping: 0.2 }, confidence: 0.8 },
        urgent: { type: "noul", noul: 0.7 },
        priority: { type: "choice", choice: "2", probabilities: { "1": 0.3, "2": 0.7 }, confidence: 0.7 },
        mood: {
          type: "score",
          score: 0.6,
          probabilities: { "0": 0.4, "1": 0.6 },
          legend: { "0": "Calm", "1": "Angry" },
          confidence: 0.5,
        },
      }),
    );
    const { text } = await provider({ apiKey: "k", fetch: fn }).infer(
      req({ system: "house rules", instruction: "Triage this ticket", schema: triage, scope }),
    );
    expect(JSON.parse(text)).toEqual({
      department: "billing",
      urgent: true,
      priority: 2,
      mood: { score: 0.6, probabilities: [0.4, 0.6], levels: ["Calm", "Angry"], confidence: 0.5 },
    });
    const body = bodyOf(calls[0]);
    expect(body.state).toEqual({ ticket: "charged twice" });
    const context = "house rules\n\nYou triage tickets.\n\nTriage this ticket";
    expect(body.questions).toEqual({
      department: {
        type: "choice",
        instructions: { context, question: "Which team owns this?" },
        criteria: { billing: null, shipping: null },
      },
      urgent: { type: "noul", instructions: { context, question: 'Determine "urgent".' } },
      priority: {
        type: "choice",
        instructions: { context, question: 'Determine "priority".' },
        criteria: { "1": null, "2": null },
      },
      mood: { type: "score", instructions: { context, question: "How frustrated?" }, criteria: ["Calm", "Angry"] },
    });
  });

  it("no contextual value: the ask text is the state and the questions carry no repeated context", async () => {
    const { fn, calls } = fakeFetch(() => answersReply({ value: { type: "noul", noul: 0.9 } }));
    await provider({ apiKey: "k", fetch: fn }).infer(req({ instruction: "Is it urgent?", schema: bool }));
    expect(bodyOf(calls[0]).state).toBe("Is it urgent?");
    expect(bodyOf(calls[0]).questions.value).toEqual({
      type: "noul",
      instructions: "Determine the value the request asks for.",
    });
  });

  it("a correction turn is ignored: the same state is sent again", async () => {
    const { fn, calls } = fakeFetch(() => answersReply({ value: { type: "noul", noul: 0.9 } }));
    await provider({ apiKey: "k", fetch: fn }).infer(
      req({ instruction: "q", schema: bool, correction: { response: "bad", error: "oops" } }),
    );
    expect(bodyOf(calls[0]).state).toBe("q");
    expect(JSON.stringify(bodyOf(calls[0]))).not.toContain("oops");
  });

  it("threshold: the factory option, overridden per ask by params.providerOptions.threshold", async () => {
    const { fn } = fakeFetch(() => answersReply({ value: { type: "noul", noul: 0.7 } }));
    const strict = provider({ apiKey: "k", fetch: fn, threshold: 0.8 });
    expect((await strict.infer(req({ schema: bool }))).text).toBe("false");
    expect((await strict.infer(req({ schema: bool }, { params: { providerOptions: { threshold: 0.6 } } }))).text).toBe(
      "true",
    );
    expect((await provider({ apiKey: "k", fetch: fn }).infer(req({ schema: bool }))).text).toBe("true");
  });

  it("forwards the abort signal", async () => {
    let seen: AbortSignal | null | undefined;
    const fn = (async (_url: unknown, init: unknown) => {
      seen = (init as RequestInit).signal;
      return new Response(JSON.stringify({ answers: { value: { type: "noul", noul: 1 } } }));
    }) as typeof globalThis.fetch;
    const controller = new AbortController();
    await provider({ apiKey: "k", fetch: fn }).infer(req({ schema: bool }, { signal: controller.signal }));
    expect(seen).toBe(controller.signal);
  });
});

describe("typesafe provider — keys", () => {
  it("reads the key from a custom apiKeyEnv", async () => {
    process.env.NOLA_TEST_TS_KEY = "k-123";
    try {
      const { fn, calls } = fakeFetch(() => answersReply({ value: { type: "noul", noul: 1 } }));
      await provider({ apiKeyEnv: "NOLA_TEST_TS_KEY", fetch: fn }).infer(req({ schema: bool }));
      expect(new Headers(calls[0]?.init.headers).get("authorization")).toBe("Bearer k-123");
    } finally {
      delete process.env.NOLA_TEST_TS_KEY;
    }
  });

  it("missing key: names the env var, points at nola.config.ts, is definitive, and never fetches", async () => {
    delete process.env.NOLA_TEST_TS_MISSING;
    const { fn, calls } = fakeFetch(() => answersReply({}));
    const err = (await provider({ apiKeyEnv: "NOLA_TEST_TS_MISSING", fetch: fn })
      .infer(req({ schema: bool }))
      .catch((e: unknown) => e)) as NolaProviderError;
    expect(err).toBeInstanceOf(NolaProviderError);
    expect(err.message).toMatch(/NOLA_TEST_TS_MISSING/);
    expect(err.message).toMatch(/nola\.config\.ts/);
    expect(err.message).toMatch(/typesafe\(\{ apiKeyEnv/);
    expect(err.definitive).toBe(true);
    expect(calls).toHaveLength(0);
  });
});

describe("typesafe provider — errors", () => {
  const failure = (fn: typeof globalThis.fetch, init: Parameters<typeof modelOf>[0]) =>
    provider({ apiKey: "k", fetch: fn })
      .infer(req(init))
      .catch((e: unknown) => e) as Promise<NolaProviderError>;

  it("an unsupported output type fails definitively before any fetch, naming the path", async () => {
    const { fn, calls } = fakeFetch(() => answersReply({}));
    const err = await failure(fn, { schema: { type: "string" } });
    expect(err).toBeInstanceOf(NolaProviderError);
    expect(err.definitive).toBe(true);
    expect(err.message).toBe(
      "TypeSafe cannot serve this ask: the output type is a free-form string; typesafe() serves Choice, Scale and Prob, literal unions and booleans",
    );
    expect(calls).toHaveLength(0);
  });

  it("free text (no schema) is unsupported too", async () => {
    const { fn, calls } = fakeFetch(() => answersReply({}));
    const err = await failure(fn, { schema: null });
    expect(err.definitive).toBe(true);
    expect(err.message).toMatch(/no output schema/);
    expect(calls).toHaveLength(0);
  });

  it("non-2xx carries status, the body excerpt, and Retry-After", async () => {
    const { fn } = fakeFetch(() => ({ status: 429, body: { error: "slow down" }, headers: { "retry-after": "2" } }));
    const err = await failure(fn, { schema: bool });
    expect(err).toBeInstanceOf(NolaProviderError);
    expect(err.status).toBe(429);
    expect(err.retryAfterMs).toBe(2000);
    expect(err.definitive).toBeUndefined();
    expect(err.message).toMatch(/^TypeSafe request failed: 429 /);
    expect(err.message).toContain("slow down");
  });

  it("a 2xx missing an answer is definitive", async () => {
    const { fn } = fakeFetch(() => answersReply({}));
    const err = await failure(fn, { schema: bool });
    expect(err.definitive).toBe(true);
    expect(err.message).toBe('TypeSafe reply is malformed: answer "value" is missing from the reply');
  });

  it("a 2xx choosing a foreign label is definitive", async () => {
    const { fn } = fakeFetch(() => answersReply({ value: { type: "choice", choice: "nope" } }));
    const err = await failure(fn, { schema: { type: "string", enum: ["a", "b"] } });
    expect(err.definitive).toBe(true);
    expect(err.message).toBe(
      'TypeSafe reply is malformed: answer "value" chose "nope", which is not one of the options sent',
    );
  });

  it("a 2xx with no answers object is definitive", async () => {
    const { fn } = fakeFetch(() => ({ body: { model: "jev-latest" } }));
    const err = await failure(fn, { schema: bool });
    expect(err.definitive).toBe(true);
    expect(err.message).toBe("TypeSafe reply is malformed: no answers object");
  });

  it("a non-JSON 2xx body is definitive", async () => {
    const { fn } = fakeFetch(() => ({ body: "<html>" }));
    const err = await failure(fn, { schema: bool });
    expect(err.definitive).toBe(true);
    expect(err.message).toMatch(/^TypeSafe reply is not JSON/);
  });
});
