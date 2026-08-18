import type { JsonSchema } from "@nola-lang/core";
import { openai } from "@nola-lang/providers";
import { NolaProviderError } from "@nola-lang/runtime";
import { describe, expect, it, vi } from "vitest";

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

const chatReply = (content: unknown) => ({
  body: { choices: [{ message: { content: typeof content === "string" ? content : JSON.stringify(content) } }] },
});

describe("openai provider", () => {
  it("wraps scalar schemas in a {value} envelope and unwraps the reply", async () => {
    const { fn, calls } = fakeFetch(() => chatReply({ value: "John" }));
    const p = openai({ apiKey: "k", fetch: fn, model: "m" });
    const { text } = await p.complete({
      system: "s",
      messages: [{ role: "user", content: "m" }],
      output: { syntax: "json", schema: { type: "string" } },
    });
    expect(text).toBe('"John"');
    const body = JSON.parse(String(calls[0]?.init.body)) as {
      model: string;
      messages: Array<{ role: string; content: string }>;
      response_format: {
        type: string;
        json_schema: { strict: boolean; schema: { type: string; properties: { value: unknown }; required: string[] } };
      };
    };
    expect(body.model).toBe("m");
    expect(body.messages[0]?.role).toBe("system");
    // Enveloped scalars: the model is instructed to wrap its answer so that
    // generate-then-validate backends don't emit a bare value failing the {value} schema.
    expect(body.messages[0]?.content).toContain("s");
    expect(body.messages[0]?.content).toContain('"value"');
    expect(body.response_format.type).toBe("json_schema");
    expect(body.response_format.json_schema.strict).toBe(true);
    expect(body.response_format.json_schema.schema.required).toEqual(["value"]);
  });

  it("transports optionals as nullable-required and strips nulls on the way back", async () => {
    const schema: JsonSchema = {
      type: "object",
      properties: { id: { type: "string" }, name: { type: "string" } },
      required: ["id"],
      additionalProperties: false,
    };
    const { fn, calls } = fakeFetch(() => chatReply({ id: "1", name: null }));
    const p = openai({ apiKey: "k", fetch: fn, model: "m" });
    const { text } = await p.complete({ system: "s", messages: [], output: { syntax: "json", schema } });
    expect(JSON.parse(text)).toEqual({ id: "1" });
    const sent = JSON.parse(String(calls[0]?.init.body)).response_format.json_schema.schema as {
      required: string[];
      properties: { name: unknown };
    };
    expect(sent.required.sort()).toEqual(["id", "name"]);
    expect(sent.properties.name).toEqual({ anyOf: [{ type: "string" }, { type: "null" }] });
  });

  it("carries enum through the strict transport", async () => {
    const { fn, calls } = fakeFetch(() => chatReply({ value: "billing" }));
    const p = openai({ apiKey: "k", fetch: fn, model: "m" });
    const { text } = await p.complete({
      system: "s",
      messages: [],
      output: { syntax: "json", schema: { type: "string", enum: ["billing", "refund"] } },
    });
    expect(text).toBe('"billing"');
    const sent = JSON.parse(String(calls[0]?.init.body)).response_format.json_schema.schema as {
      properties: { value: unknown };
    };
    expect(sent.properties.value).toEqual({ type: "string", enum: ["billing", "refund"] });
  });

  it("passes object replies through when schema root is an object", async () => {
    const schema: JsonSchema = {
      type: "object",
      properties: { ok: { type: "boolean" } },
      required: ["ok"],
      additionalProperties: false,
    };
    const { fn } = fakeFetch(() => chatReply({ ok: true }));
    const p = openai({ apiKey: "k", fetch: fn, model: "m" });
    const { text } = await p.complete({ system: "s", messages: [], output: { syntax: "json", schema } });
    expect(JSON.parse(text)).toEqual({ ok: true });
  });

  it("does not add the envelope note when the schema root is already an object", async () => {
    const schema: JsonSchema = {
      type: "object",
      properties: { ok: { type: "boolean" } },
      required: ["ok"],
      additionalProperties: false,
    };
    const { fn, calls } = fakeFetch(() => chatReply({ ok: true }));
    await openai({ apiKey: "k", fetch: fn, model: "m" }).complete({ system: "s", messages: [], output: { syntax: "json", schema } });
    const body = JSON.parse(String(calls[0]?.init.body)) as { messages: Array<{ content: string }> };
    expect(body.messages[0]?.content).toBe("s");
  });

  it("recovers the model answer from a Groq json_validate_failed 400 (bare value)", async () => {
    const groqError = {
      error: {
        message: "Failed to generate JSON.",
        type: "invalid_request_error",
        code: "json_validate_failed",
        failed_generation: JSON.stringify("two"),
      },
    };
    const { fn } = fakeFetch(() => ({ status: 400, body: groqError }));
    const { text } = await openai({ apiKey: "k", fetch: fn, model: "m" }).complete({
      system: "s",
      messages: [],
      output: { syntax: "json", schema: { type: "string" } },
    });
    expect(text).toBe('"two"');
  });

  it("recovers an enveloped object from failed_generation", async () => {
    const groqError = { error: { code: "json_validate_failed", failed_generation: JSON.stringify({ value: "two" }) } };
    const { fn } = fakeFetch(() => ({ status: 400, body: groqError }));
    const { text } = await openai({ apiKey: "k", fetch: fn, model: "m" }).complete({
      system: "s",
      messages: [],
      output: { syntax: "json", schema: { type: "string" } },
    });
    expect(text).toBe('"two"');
  });

  it("still throws on a 400 with no recoverable failed_generation", async () => {
    const { fn } = fakeFetch(() => ({ status: 400, body: { error: { message: "bad request" } } }));
    await expect(
      openai({ apiKey: "k", fetch: fn, model: "m" }).complete({
        system: "s",
        messages: [],
        output: { syntax: "json", schema: { type: "string" } },
      }),
    ).rejects.toBeInstanceOf(NolaProviderError);
  });

  it("omits response_format when no schema requested and returns raw text", async () => {
    const { fn, calls } = fakeFetch(() => chatReply("free text answer"));
    const p = openai({ apiKey: "k", fetch: fn, model: "m" });
    const { text } = await p.complete({ system: "s", messages: [], output: { syntax: "json" } });
    expect(text).toBe("free text answer");
    expect(JSON.parse(String(calls[0]?.init.body))).not.toHaveProperty("response_format");
  });

  it("throws NolaProviderError without an api key", async () => {
    const original = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    try {
      const { fn } = fakeFetch(() => chatReply("x"));
      await expect(openai({ fetch: fn, model: "m" }).complete({ system: "s", messages: [], output: { syntax: "json" } })).rejects.toBeInstanceOf(
        NolaProviderError,
      );
    } finally {
      if (original !== undefined) process.env.OPENAI_API_KEY = original;
    }
  });

  it("wraps HTTP failures with status and body excerpt", async () => {
    const { fn } = fakeFetch(() => ({ status: 429, body: { error: { message: "rate limited" } } }));
    const err = await openai({ apiKey: "k", fetch: fn, model: "m" })
      .complete({ system: "s", messages: [], output: { syntax: "json" } })
      .catch((e) => e);
    expect(err).toBeInstanceOf(NolaProviderError);
    expect(err.message).toContain("429");
    expect(err.message).toContain("rate limited");
  });

  it("carries a delta-seconds Retry-After header as retryAfterMs", async () => {
    const { fn } = fakeFetch(() => ({ status: 429, body: "rate limited", headers: { "retry-after": "2" } }));
    const err = await openai({ apiKey: "k", fetch: fn, model: "m" })
      .complete({ system: "s", messages: [], output: { syntax: "json" } })
      .catch((e) => e);
    expect(err).toBeInstanceOf(NolaProviderError);
    expect(err.retryAfterMs).toBe(2000);
  });

  it("carries an HTTP-date Retry-After header as a forward delta", async () => {
    const date = new Date(Date.now() + 5_000).toUTCString();
    const { fn } = fakeFetch(() => ({ status: 429, body: "rate limited", headers: { "retry-after": date } }));
    const err = await openai({ apiKey: "k", fetch: fn, model: "m" })
      .complete({ system: "s", messages: [], output: { syntax: "json" } })
      .catch((e) => e);
    expect(err.retryAfterMs).toBeGreaterThan(0);
    expect(err.retryAfterMs).toBeLessThanOrEqual(5_000);
  });

  it("leaves retryAfterMs undefined for a missing or malformed Retry-After", async () => {
    const missing = fakeFetch(() => ({ status: 429, body: "rate limited" }));
    const bad = fakeFetch(() => ({ status: 429, body: "rate limited", headers: { "retry-after": "soon" } }));
    for (const { fn } of [missing, bad]) {
      const err = await openai({ apiKey: "k", fetch: fn, model: "m" })
        .complete({ system: "s", messages: [], output: { syntax: "json" } })
        .catch((e) => e);
      expect(err.retryAfterMs).toBeUndefined();
    }
  });

  it("accepts a bare model string as shorthand for { model } with all other options defaulted", async () => {
    const original = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "k-short";
    const { fn, calls } = fakeFetch(() => chatReply("x"));
    vi.stubGlobal("fetch", fn);
    try {
      const { text } = await openai("gpt-5-mini").complete({ system: "s", messages: [], output: { syntax: "json" } });
      expect(text).toBe("x");
      expect(calls[0]?.url).toBe("https://api.openai.com/v1/chat/completions");
      expect(new Headers(calls[0]?.init.headers).get("authorization")).toBe("Bearer k-short");
      expect(JSON.parse(String(calls[0]?.init.body)).model).toBe("gpt-5-mini");
    } finally {
      vi.unstubAllGlobals();
      if (original === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = original;
    }
  });

  it("serves OpenAI-compatible endpoints: baseUrl + apiKeyEnv + model reach the wire together", async () => {
    // The documented recipe shape for Ollama / OpenRouter / Groq / DeepSeek / xAI.
    process.env.NOLA_TEST_COMPAT_KEY = "sk-or-abc";
    try {
      const { fn, calls } = fakeFetch(() => chatReply("x"));
      await openai({
        baseUrl: "https://openrouter.ai/api/v1",
        apiKeyEnv: "NOLA_TEST_COMPAT_KEY",
        model: "deepseek/deepseek-chat",
        fetch: fn,
      }).complete({ system: "s", messages: [], output: { syntax: "json" } });
      expect(calls[0]?.url).toBe("https://openrouter.ai/api/v1/chat/completions");
      expect(new Headers(calls[0]?.init.headers).get("authorization")).toBe("Bearer sk-or-abc");
      expect(JSON.parse(String(calls[0]?.init.body)).model).toBe("deepseek/deepseek-chat");
    } finally {
      delete process.env.NOLA_TEST_COMPAT_KEY;
    }
  });

  it("honors model and baseUrl options", async () => {
    const { fn, calls } = fakeFetch(() => chatReply("x"));
    await openai({ apiKey: "k", fetch: fn, model: "gpt-4.1", baseUrl: "https://proxy.local/v1" }).complete({
      system: "s",
      messages: [],
      output: { syntax: "json" },
    });
    expect(calls[0]?.url).toBe("https://proxy.local/v1/chat/completions");
    expect(JSON.parse(String(calls[0]?.init.body)).model).toBe("gpt-4.1");
  });
});
