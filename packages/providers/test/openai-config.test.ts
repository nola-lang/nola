import { openai } from "@nola-lang/providers";
import { NolaProviderError } from "@nola-lang/runtime";
import { describe, expect, it, vi } from "vitest";
import { requestOf } from "./helpers/model.js";

const req = requestOf({ system: "s" });
const okBody = JSON.stringify({ choices: [{ message: { content: JSON.stringify({ value: "hi" }) } }] });

describe("openai provider config", () => {
  it("reads the key from a custom apiKeyEnv and sends it as the bearer token", async () => {
    process.env.NOLA_TEST_LLM_KEY = "k-123";
    try {
      let auth: string | null = null;
      const fetchStub: typeof fetch = async (_url, init) => {
        auth = new Headers(init?.headers).get("authorization");
        return new Response(okBody, { status: 200 });
      };
      await openai({ apiKeyEnv: "NOLA_TEST_LLM_KEY", fetch: fetchStub, model: "m" }).infer(req);
      expect(auth).toBe("Bearer k-123");
    } finally {
      delete process.env.NOLA_TEST_LLM_KEY;
    }
  });

  it("missing key (no custom fetch): names the exact env var, points at nola.config.ts, is definitive, and never fetches", async () => {
    delete process.env.NOLA_TEST_MISSING_KEY;
    // No `fetch` option: a custom fetch would own authentication and make the key optional.
    const globalFetch = vi.fn(async () => new Response(okBody));
    vi.stubGlobal("fetch", globalFetch);
    try {
      const p = openai({ apiKeyEnv: "NOLA_TEST_MISSING_KEY", model: "m" });
      const err = (await p.infer(req).catch((e: unknown) => e)) as NolaProviderError;
      expect(err).toBeInstanceOf(NolaProviderError);
      expect(err.message).toMatch(/NOLA_TEST_MISSING_KEY/);
      expect(err.message).toMatch(/nola\.config\.ts/);
      expect(err.definitive).toBe(true);
      expect(globalFetch).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("HTTP failures carry the response status", async () => {
    process.env.NOLA_TEST_LLM_KEY = "k";
    try {
      const p = openai({
        apiKeyEnv: "NOLA_TEST_LLM_KEY",
        model: "m",
        fetch: async () => new Response("boom", { status: 500, statusText: "Server Error" }),
      });
      const err = (await p.infer(req).catch((e: unknown) => e)) as NolaProviderError;
      expect(err).toBeInstanceOf(NolaProviderError);
      expect(err.status).toBe(500);
    } finally {
      delete process.env.NOLA_TEST_LLM_KEY;
    }
  });
});
