import { openai } from "@nola-lang/providers";
import { NolaProviderError } from "@nola-lang/runtime";
import { describe, expect, it } from "vitest";

const req = {
  system: "s",
  messages: [{ role: "user" as const, content: "u" }],
  output: { syntax: "json" as const },
};
const okBody = JSON.stringify({ choices: [{ message: { content: "hi" } }] });

describe("openai provider config", () => {
  it("reads the key from a custom apiKeyEnv and sends it as the bearer token", async () => {
    process.env.NOLA_TEST_LLM_KEY = "k-123";
    try {
      let auth: string | null = null;
      const fetchStub: typeof fetch = async (_url, init) => {
        auth = new Headers(init?.headers).get("authorization");
        return new Response(okBody, { status: 200 });
      };
      await openai({ apiKeyEnv: "NOLA_TEST_LLM_KEY", fetch: fetchStub, model: "m" }).complete(req);
      expect(auth).toBe("Bearer k-123");
    } finally {
      delete process.env.NOLA_TEST_LLM_KEY;
    }
  });

  it("missing key: names the exact env var, points at nola.config.ts, and is definitive", async () => {
    delete process.env.NOLA_TEST_MISSING_KEY;
    const p = openai({ apiKeyEnv: "NOLA_TEST_MISSING_KEY", fetch: async () => new Response(okBody), model: "m" });
    const err = (await p.complete(req).catch((e: unknown) => e)) as NolaProviderError;
    expect(err).toBeInstanceOf(NolaProviderError);
    expect(err.message).toMatch(/NOLA_TEST_MISSING_KEY/);
    expect(err.message).toMatch(/nola\.config\.ts/);
    expect(err.definitive).toBe(true);
  });

  it("HTTP failures carry the response status", async () => {
    process.env.NOLA_TEST_LLM_KEY = "k";
    try {
      const p = openai({
        apiKeyEnv: "NOLA_TEST_LLM_KEY",
        model: "m",
        fetch: async () => new Response("boom", { status: 500, statusText: "Server Error" }),
      });
      const err = (await p.complete(req).catch((e: unknown) => e)) as NolaProviderError;
      expect(err).toBeInstanceOf(NolaProviderError);
      expect(err.status).toBe(500);
    } finally {
      delete process.env.NOLA_TEST_LLM_KEY;
    }
  });
});
