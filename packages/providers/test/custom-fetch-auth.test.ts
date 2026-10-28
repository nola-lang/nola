import { anthropic, google, openai, typesafe } from "@nola-lang/providers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { requestOf } from "./helpers/model.js";

type Call = { url: string; headers: Record<string, string> };

/** A fetch that records the headers it was given (lower-cased) and answers with `body`. */
function recording(body: unknown) {
  const calls: Call[] = [];
  const fn = (async (url: unknown, init?: RequestInit) => {
    const given = (init?.headers as Record<string, string> | undefined) ?? {};
    calls.push({ url: String(url), headers: Object.fromEntries(Object.entries(given).map(([k, v]) => [k.toLowerCase(), v])) });
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof globalThis.fetch;
  return { fn, calls };
}

// Each vendor's minimal success body for the default `{ type: "string" }` schema, which the
// providers envelope as `{ value }`.
const openaiBody = { choices: [{ message: { content: JSON.stringify({ value: "x" }) } }] };
const anthropicBody = { content: [{ type: "text", text: JSON.stringify({ value: "x" }) }] };
const googleBody = { candidates: [{ content: { parts: [{ text: JSON.stringify({ value: "x" }) }] } }] };

const KEYS = ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GEMINI_API_KEY", "TYPESAFE_API_KEY"] as const;
const saved: Partial<Record<(typeof KEYS)[number], string | undefined>> = {};
beforeEach(() => {
  for (const k of KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
});
afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("a custom fetch owns authentication: no key needed, no vendor auth header sent without one", () => {
  it("openai sends no authorization header without a key", async () => {
    const { fn, calls } = recording(openaiBody);
    const res = await openai({ model: "m", fetch: fn }).infer(requestOf({ system: "s" }));
    expect(res.text).toBe(JSON.stringify("x"));
    expect(calls[0]?.headers.authorization).toBeUndefined();
  });

  it("openai still sends the key when it has one", async () => {
    const { fn, calls } = recording(openaiBody);
    await openai({ model: "m", apiKey: "k", fetch: fn }).infer(requestOf({ system: "s" }));
    expect(calls[0]?.headers.authorization).toBe("Bearer k");
  });

  it("anthropic sends no x-api-key without a key, and the key when it has one", async () => {
    const { fn, calls } = recording(anthropicBody);
    await anthropic({ model: "m", fetch: fn }).infer(requestOf({ system: "s" }));
    expect(calls[0]?.headers["x-api-key"]).toBeUndefined();
    expect(calls[0]?.headers["anthropic-version"]).toBe("2023-06-01");
    await anthropic({ model: "m", apiKey: "k", fetch: fn }).infer(requestOf({ system: "s" }));
    expect(calls[1]?.headers["x-api-key"]).toBe("k");
  });

  it("google sends no x-goog-api-key without a key, and the key when it has one", async () => {
    const { fn, calls } = recording(googleBody);
    await google({ model: "m", fetch: fn }).infer(requestOf({ system: "s" }));
    expect(calls[0]?.headers["x-goog-api-key"]).toBeUndefined();
    await google({ model: "m", apiKey: "k", fetch: fn }).infer(requestOf({ system: "s" }));
    expect(calls[1]?.headers["x-goog-api-key"]).toBe("k");
  });

  it("typesafe gets past the key check with a custom fetch (a plain string ask then fails on its own terms, before the network)", async () => {
    const { fn, calls } = recording({ answers: {} });
    await expect(typesafe({ fetch: fn }).infer(requestOf({ system: "s" }))).rejects.toThrow(/cannot serve this ask/);
    expect(calls).toHaveLength(0);
  });

  it("without a custom fetch the key is still required, with the message as before", async () => {
    await expect(openai({ model: "m" }).infer(requestOf({ system: "s" }))).rejects.toThrow(/OpenAI API key not found/);
    await expect(anthropic({ model: "m" }).infer(requestOf({ system: "s" }))).rejects.toThrow(/Anthropic API key not found/);
    await expect(google({ model: "m" }).infer(requestOf({ system: "s" }))).rejects.toThrow(/Google API key not found/);
    await expect(typesafe().infer(requestOf({ system: "s" }))).rejects.toThrow(/TypeSafe API key not found/);
  });
});
