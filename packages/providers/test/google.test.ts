import type { JsonSchema } from "@nola-lang/core";
import { DEFAULT_SYSTEM, renderPrompt } from "@nola-lang/core";
import { google } from "@nola-lang/providers";
import { NolaProviderError } from "@nola-lang/runtime";
import { describe, expect, it, vi } from "vitest";
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

const candidateReply = (content: unknown) => ({
  body: { candidates: [{ content: { parts: [{ text: typeof content === "string" ? content : JSON.stringify(content) }] } }] },
});

describe("google provider", () => {
  it("renders the intent through renderPrompt, sends system_instruction + contents, and echoes what it sent", async () => {
    const { fn, calls } = fakeFetch(() => candidateReply({ v: "x" }));
    const req = requestOf({
      system: "Be terse.",
      schema: { type: "object", properties: { v: { type: "string" } }, required: ["v"], additionalProperties: false },
      correction: { response: "reply", error: "again" },
    });
    const res = await google({ apiKey: "k", fetch: fn, model: "m" }).infer(req);
    const expected = renderPrompt(req.intent);
    const body = JSON.parse(String(calls[0]?.init.body)) as {
      system_instruction: { parts: { text: string }[] };
      contents: { role: string; parts: { text: string }[] }[];
    };
    expect(body.system_instruction.parts[0]?.text).toBe(expected.system);
    expect(body.contents.map((c) => [c.role, c.parts[0]?.text])).toEqual(
      expected.messages.map((m) => [m.role === "assistant" ? "model" : "user", m.content]),
    );
    expect(body.contents).toHaveLength(3);
    expect(res.sent).toEqual(expected);
  });

  it("speaks the generateContent dialect: url, x-goog-api-key, system_instruction, role mapping", async () => {
    const { fn, calls } = fakeFetch(() => candidateReply({ value: "free text answer" }));
    const p = google({ apiKey: "k", fetch: fn, model: "gemini-x" });
    const { text } = await p.infer(requestOf({ system: "s", correction: { response: "bad", error: "oops" } }));
    expect(text).toBe('"free text answer"');
    expect(p.name).toBe("google");
    expect(calls[0]?.url).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-x:generateContent");
    expect(new Headers(calls[0]?.init.headers).get("x-goog-api-key")).toBe("k");
    const body = JSON.parse(String(calls[0]?.init.body)) as {
      system_instruction: { parts: Array<{ text: string }> };
      contents: Array<{ role: string; parts: Array<{ text: string }> }>;
    };
    expect(body.system_instruction.parts[0]?.text.startsWith("s")).toBe(true); // system.message replaces the default system text
    // Gemini's dialogue roles are user/model, not user/assistant; the correction
    // pair exercises the role-mapped assistant turn.
    expect(body.contents.map((c) => c.role)).toEqual(["user", "model", "user"]);
  });

  it("requests structured output via generationConfig.responseJsonSchema and passes object schemas through", async () => {
    const schema: JsonSchema = {
      type: "object",
      properties: { id: { type: "string" }, name: { type: "string" } },
      required: ["id"],
      additionalProperties: false,
    };
    const { fn, calls } = fakeFetch(() => candidateReply({ id: "1" }));
    const { text } = await google({ apiKey: "k", fetch: fn, model: "m" }).infer(requestOf({ system: "s", schema }));
    expect(JSON.parse(text)).toEqual({ id: "1" });
    const body = JSON.parse(String(calls[0]?.init.body)) as {
      generationConfig: { responseMimeType: string; responseJsonSchema: unknown };
    };
    expect(body.generationConfig.responseMimeType).toBe("application/json");
    expect(body.generationConfig.responseJsonSchema).toEqual(schema);
  });

  it("wraps scalar schemas in a {value} envelope with a system note and unwraps the reply", async () => {
    const { fn, calls } = fakeFetch(() => candidateReply({ value: "billing" }));
    const { text } = await google({ apiKey: "k", fetch: fn, model: "m" }).infer(
      requestOf({ system: "s", schema: { type: "string", enum: ["billing", "refund"] } }),
    );
    expect(text).toBe('"billing"');
    const body = JSON.parse(String(calls[0]?.init.body)) as {
      system_instruction: { parts: Array<{ text: string }> };
      generationConfig: { responseJsonSchema: { type: string; properties: { value: unknown }; required: string[] } };
    };
    expect(body.system_instruction.parts[0]?.text.startsWith("s")).toBe(true);
    expect(body.system_instruction.parts[0]?.text).toContain('"value"');
    const sent = body.generationConfig.responseJsonSchema;
    expect(sent.type).toBe("object");
    expect(sent.required).toEqual(["value"]);
    expect(sent.properties.value).toEqual({ type: "string", enum: ["billing", "refund"] });
  });

  it("requests structured output for the default (bare-string) schema when none is given", async () => {
    const { fn, calls } = fakeFetch(() => candidateReply({ value: "x" }));
    await google({ apiKey: "k", fetch: fn, model: "m" }).infer(requestOf({ system: "s" }));
    expect(JSON.parse(String(calls[0]?.init.body))).toHaveProperty("generationConfig");
  });

  it("omits generationConfig when no schema requested", async () => {
    const { fn, calls } = fakeFetch(() => candidateReply("x"));
    await google({ apiKey: "k", fetch: fn, model: "m" }).infer(requestOf({ system: "s", schema: null }));
    expect(JSON.parse(String(calls[0]?.init.body))).not.toHaveProperty("generationConfig");
  });

  it("throws NolaProviderError when the response has no candidate text", async () => {
    const { fn } = fakeFetch(() => ({ body: { candidates: [] } }));
    await expect(google({ apiKey: "k", fetch: fn, model: "m" }).infer(requestOf({ system: "s" }))).rejects.toBeInstanceOf(
      NolaProviderError,
    );
  });

  it("reads the key from a custom apiKeyEnv and sends it as x-goog-api-key", async () => {
    process.env.NOLA_TEST_GOOGLE_KEY = "k-789";
    try {
      const { fn, calls } = fakeFetch(() => candidateReply({ value: "x" }));
      await google({ apiKeyEnv: "NOLA_TEST_GOOGLE_KEY", fetch: fn, model: "m" }).infer(requestOf({ system: "s" }));
      expect(new Headers(calls[0]?.init.headers).get("x-goog-api-key")).toBe("k-789");
    } finally {
      delete process.env.NOLA_TEST_GOOGLE_KEY;
    }
  });

  it("missing key: names the exact env var, points at nola.config.ts, and is definitive", async () => {
    const original = process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    try {
      const { fn } = fakeFetch(() => candidateReply("x"));
      const err = (await google({ fetch: fn, model: "m" })
        .infer(requestOf({ system: "s" }))
        .catch((e: unknown) => e)) as NolaProviderError;
      expect(err).toBeInstanceOf(NolaProviderError);
      expect(err.message).toMatch(/GEMINI_API_KEY/);
      expect(err.message).toMatch(/nola\.config\.ts/);
      expect(err.definitive).toBe(true);
    } finally {
      if (original !== undefined) process.env.GEMINI_API_KEY = original;
    }
  });

  it("wraps HTTP failures with status and body excerpt", async () => {
    const { fn } = fakeFetch(() => ({ status: 429, body: { error: { message: "quota exceeded" } } }));
    const err = (await google({ apiKey: "k", fetch: fn, model: "m" })
      .infer(requestOf({ system: "s" }))
      .catch((e: unknown) => e)) as NolaProviderError;
    expect(err).toBeInstanceOf(NolaProviderError);
    expect(err.status).toBe(429);
    expect(err.message).toContain("429");
    expect(err.message).toContain("quota exceeded");
  });

  it("carries a delta-seconds Retry-After header as retryAfterMs", async () => {
    const { fn } = fakeFetch(() => ({ status: 429, body: "quota", headers: { "retry-after": "3" } }));
    const err = (await google({ apiKey: "k", fetch: fn, model: "m" })
      .infer(requestOf({ system: "s" }))
      .catch((e: unknown) => e)) as NolaProviderError;
    expect(err.retryAfterMs).toBe(3000);
  });

  it("accepts a bare model string as shorthand for { model } with all other options defaulted", async () => {
    const original = process.env.GEMINI_API_KEY;
    process.env.GEMINI_API_KEY = "k-short";
    const { fn, calls } = fakeFetch(() => candidateReply({ value: "x" }));
    vi.stubGlobal("fetch", fn);
    try {
      const { text } = await google("gemini-2.5-flash").infer(requestOf({ system: "s" }));
      expect(text).toBe('"x"');
      expect(calls[0]?.url).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent");
      expect(new Headers(calls[0]?.init.headers).get("x-goog-api-key")).toBe("k-short");
    } finally {
      vi.unstubAllGlobals();
      if (original === undefined) delete process.env.GEMINI_API_KEY;
      else process.env.GEMINI_API_KEY = original;
    }
  });

  it("honors the baseUrl option", async () => {
    const { fn, calls } = fakeFetch(() => candidateReply({ value: "x" }));
    await google({ apiKey: "k", fetch: fn, model: "m", baseUrl: "https://proxy.local/" }).infer(requestOf({ system: "s" }));
    expect(calls[0]?.url).toBe("https://proxy.local/v1beta/models/m:generateContent");
  });
});

describe("google provider — structuredOutputs (spec 2026-09-28 §3.6)", () => {
  it("structuredOutputs: false sends no responseJsonSchema and puts the schema in the system turn as <schema>", async () => {
    const { fn, calls } = fakeFetch(() => candidateReply({ v: "x" }));
    const schema: JsonSchema = { type: "object", properties: { v: { type: "string" } }, required: ["v"], additionalProperties: false };
    const res = await google({ apiKey: "k", fetch: fn, model: "m", structuredOutputs: false }).infer(requestOf({ schema }));
    const body = JSON.parse(String(calls[0]?.init.body)) as { generationConfig?: unknown; system_instruction: { parts: { text: string }[] } };
    expect(body.generationConfig).toBeUndefined();
    const system = body.system_instruction.parts[0]?.text ?? "";
    expect(system.startsWith(DEFAULT_SYSTEM)).toBe(true);
    expect(system).toContain(`\n\n<schema>\n${JSON.stringify(schema)}\n</schema>\nReply with a single JSON value conforming to the schema.`);
    expect(res.sent?.system).toBe(system);
    expect(res.text).toBe('{"v":"x"}');
  });
});
