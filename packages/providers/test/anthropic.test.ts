import type { JsonSchema } from "@nola-lang/core";
import { anthropic } from "@nola-lang/providers";
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

const messageReply = (content: unknown) => ({
  body: { content: [{ type: "text", text: typeof content === "string" ? content : JSON.stringify(content) }] },
});

describe("anthropic provider", () => {
  it("speaks the Messages API dialect: url, auth headers, top-level system, required max_tokens", async () => {
    const { fn, calls } = fakeFetch(() => messageReply("free text answer"));
    const p = anthropic({ apiKey: "k", fetch: fn, model: "m" });
    const { text } = await p.complete({
      system: "s",
      messages: [{ role: "user", content: "u" }],
      output: { syntax: "json" },
    });
    expect(text).toBe("free text answer");
    expect(p.name).toBe("anthropic");
    expect(calls[0]?.url).toBe("https://api.anthropic.com/v1/messages");
    const headers = new Headers(calls[0]?.init.headers);
    expect(headers.get("x-api-key")).toBe("k");
    expect(headers.get("anthropic-version")).toBe("2023-06-01");
    const body = JSON.parse(String(calls[0]?.init.body)) as {
      model: string;
      max_tokens: number;
      system: string;
      messages: Array<{ role: string; content: string }>;
    };
    expect(body.model).toBe("m");
    expect(body.max_tokens).toBe(4096);
    expect(body.system).toBe("s");
    expect(body.messages).toEqual([{ role: "user", content: "u" }]);
  });

  it("requests structured output via output_config.format and passes object schemas through untransformed", async () => {
    const schema: JsonSchema = {
      type: "object",
      properties: { id: { type: "string" }, name: { type: "string" } },
      required: ["id"],
      additionalProperties: false,
    };
    const { fn, calls } = fakeFetch(() => messageReply({ id: "1" }));
    const { text } = await anthropic({ apiKey: "k", fetch: fn, model: "m" }).complete({
      system: "s",
      messages: [],
      output: { syntax: "json", schema },
    });
    expect(JSON.parse(text)).toEqual({ id: "1" });
    const body = JSON.parse(String(calls[0]?.init.body)) as {
      system: string;
      output_config: { format: { type: string; schema: unknown } };
    };
    expect(body.output_config.format.type).toBe("json_schema");
    // No strict/nullable-required rewrite: Anthropic does not demand all-required.
    expect(body.output_config.format.schema).toEqual(schema);
    expect(body.system).toBe("s");
  });

  it("wraps scalar schemas in a {value} envelope with a system note and unwraps the reply", async () => {
    const { fn, calls } = fakeFetch(() => messageReply({ value: "billing" }));
    const { text } = await anthropic({ apiKey: "k", fetch: fn, model: "m" }).complete({
      system: "s",
      messages: [],
      output: { syntax: "json", schema: { type: "string", enum: ["billing", "refund"] } },
    });
    expect(text).toBe('"billing"');
    const body = JSON.parse(String(calls[0]?.init.body)) as {
      system: string;
      output_config: {
        format: { schema: { type: string; properties: { value: unknown }; required: string[] } };
      };
    };
    expect(body.system).toContain("s");
    expect(body.system).toContain('"value"');
    const sent = body.output_config.format.schema;
    expect(sent.type).toBe("object");
    expect(sent.required).toEqual(["value"]);
    expect(sent.properties.value).toEqual({ type: "string", enum: ["billing", "refund"] });
  });

  it("omits output_config when no schema requested", async () => {
    const { fn, calls } = fakeFetch(() => messageReply("x"));
    await anthropic({ apiKey: "k", fetch: fn, model: "m" }).complete({ system: "s", messages: [], output: { syntax: "json" } });
    expect(JSON.parse(String(calls[0]?.init.body))).not.toHaveProperty("output_config");
  });

  it("reads text from the first text content block, skipping non-text blocks", async () => {
    const { fn } = fakeFetch(() => ({
      body: { content: [{ type: "thinking", thinking: "" }, { type: "text", text: "answer" }] },
    }));
    const { text } = await anthropic({ apiKey: "k", fetch: fn, model: "m" }).complete({
      system: "s",
      messages: [],
      output: { syntax: "json" },
    });
    expect(text).toBe("answer");
  });

  it("throws NolaProviderError when the response has no text content", async () => {
    const { fn } = fakeFetch(() => ({ body: { content: [] } }));
    await expect(
      anthropic({ apiKey: "k", fetch: fn, model: "m" }).complete({ system: "s", messages: [], output: { syntax: "json" } }),
    ).rejects.toBeInstanceOf(NolaProviderError);
  });

  it("reads the key from a custom apiKeyEnv and sends it as x-api-key", async () => {
    process.env.NOLA_TEST_ANTHROPIC_KEY = "k-456";
    try {
      const { fn, calls } = fakeFetch(() => messageReply("x"));
      await anthropic({ apiKeyEnv: "NOLA_TEST_ANTHROPIC_KEY", fetch: fn, model: "m" }).complete({
        system: "s",
        messages: [],
        output: { syntax: "json" },
      });
      expect(new Headers(calls[0]?.init.headers).get("x-api-key")).toBe("k-456");
    } finally {
      delete process.env.NOLA_TEST_ANTHROPIC_KEY;
    }
  });

  it("missing key: names the exact env var, points at nola.config.ts, and is definitive", async () => {
    const original = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      const { fn } = fakeFetch(() => messageReply("x"));
      const err = (await anthropic({ fetch: fn, model: "m" })
        .complete({ system: "s", messages: [], output: { syntax: "json" } })
        .catch((e: unknown) => e)) as NolaProviderError;
      expect(err).toBeInstanceOf(NolaProviderError);
      expect(err.message).toMatch(/ANTHROPIC_API_KEY/);
      expect(err.message).toMatch(/nola\.config\.ts/);
      expect(err.definitive).toBe(true);
    } finally {
      if (original !== undefined) process.env.ANTHROPIC_API_KEY = original;
    }
  });

  it("wraps HTTP failures with status and body excerpt", async () => {
    const { fn } = fakeFetch(() => ({ status: 429, body: { error: { message: "rate limited" } } }));
    const err = (await anthropic({ apiKey: "k", fetch: fn, model: "m" })
      .complete({ system: "s", messages: [], output: { syntax: "json" } })
      .catch((e: unknown) => e)) as NolaProviderError;
    expect(err).toBeInstanceOf(NolaProviderError);
    expect(err.status).toBe(429);
    expect(err.message).toContain("429");
    expect(err.message).toContain("rate limited");
  });

  it("carries a delta-seconds Retry-After header as retryAfterMs", async () => {
    const { fn } = fakeFetch(() => ({ status: 429, body: "rate limited", headers: { "retry-after": "2" } }));
    const err = (await anthropic({ apiKey: "k", fetch: fn, model: "m" })
      .complete({ system: "s", messages: [], output: { syntax: "json" } })
      .catch((e: unknown) => e)) as NolaProviderError;
    expect(err.retryAfterMs).toBe(2000);
  });

  it("accepts a bare model string as shorthand for { model } with all other options defaulted", async () => {
    const original = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = "k-short";
    const { fn, calls } = fakeFetch(() => messageReply("x"));
    vi.stubGlobal("fetch", fn);
    try {
      const { text } = await anthropic("claude-sonnet-5").complete({ system: "s", messages: [], output: { syntax: "json" } });
      expect(text).toBe("x");
      expect(calls[0]?.url).toBe("https://api.anthropic.com/v1/messages");
      expect(new Headers(calls[0]?.init.headers).get("x-api-key")).toBe("k-short");
      const body = JSON.parse(String(calls[0]?.init.body)) as { model: string; max_tokens: number };
      expect(body.model).toBe("claude-sonnet-5");
      expect(body.max_tokens).toBe(4096);
    } finally {
      vi.unstubAllGlobals();
      if (original === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = original;
    }
  });

  it("honors model, baseUrl, and maxOutputTokens options", async () => {
    const { fn, calls } = fakeFetch(() => messageReply("x"));
    await anthropic({
      apiKey: "k",
      fetch: fn,
      model: "claude-sonnet-5",
      baseUrl: "https://proxy.local/",
      maxOutputTokens: 9000,
    }).complete({ system: "s", messages: [], output: { syntax: "json" } });
    expect(calls[0]?.url).toBe("https://proxy.local/v1/messages");
    const body = JSON.parse(String(calls[0]?.init.body)) as { model: string; max_tokens: number };
    expect(body.model).toBe("claude-sonnet-5");
    expect(body.max_tokens).toBe(9000);
  });
});
