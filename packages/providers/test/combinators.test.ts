import type { LanguageModel } from "@nola-lang/core";
import { isPlatformModel, NolaConfigError, PLATFORM_MODEL } from "@nola-lang/core";
import { constant, exponential, fallback, isDefinitiveProviderError, roundRobin, withRetry } from "@nola-lang/providers";
import { NolaProviderError } from "@nola-lang/runtime";
import { describe, expect, it } from "vitest";
import { requestOf } from "./helpers/model.js";

const req = requestOf();
const succeeding = (name: string, text: string): LanguageModel => ({ name, complete: async () => ({ text }) });
const failing = (name: string, error: Error): LanguageModel => ({
  name,
  complete: async () => {
    throw error;
  },
});

describe("isDefinitiveProviderError", () => {
  it("classifies 4xx as definitive except 408/429", () => {
    expect(isDefinitiveProviderError(new NolaProviderError("x", { status: 401 }))).toBe(true);
    expect(isDefinitiveProviderError(new NolaProviderError("x", { status: 400 }))).toBe(true);
    expect(isDefinitiveProviderError(new NolaProviderError("x", { status: 408 }))).toBe(false);
    expect(isDefinitiveProviderError(new NolaProviderError("x", { status: 429 }))).toBe(false);
  });

  it("treats 5xx, statusless, and foreign errors as transient", () => {
    expect(isDefinitiveProviderError(new NolaProviderError("x", { status: 500 }))).toBe(false);
    expect(isDefinitiveProviderError(new NolaProviderError("x"))).toBe(false);
    expect(isDefinitiveProviderError(new Error("net"))).toBe(false);
  });

  it("honors the explicit definitive flag", () => {
    expect(isDefinitiveProviderError(new NolaProviderError("x", { definitive: true }))).toBe(true);
  });
});

describe("withRetry", () => {
  it("retries transient failures and succeeds", async () => {
    let calls = 0;
    const flaky: LanguageModel = {
      name: "flaky",
      complete: async () => {
        calls++;
        if (calls < 3) throw new NolaProviderError("boom", { status: 500 });
        return { text: "ok" };
      },
    };
    const p = withRetry(flaky, constant({ maxRetries: 3 }));
    expect((await p.complete(req)).text).toBe("ok");
    expect(calls).toBe(3);
  });

  it("does not retry definitive errors", async () => {
    let calls = 0;
    const auth: LanguageModel = {
      name: "auth",
      complete: async () => {
        calls++;
        throw new NolaProviderError("401", { status: 401 });
      },
    };
    await expect(withRetry(auth, constant({ maxRetries: 3 })).complete(req)).rejects.toThrow("401");
    expect(calls).toBe(1);
  });

  it("gives up after maxRetries and rethrows the last error", async () => {
    let calls = 0;
    const dead: LanguageModel = {
      name: "dead",
      complete: async () => {
        calls++;
        throw new NolaProviderError("down", { status: 503 });
      },
    };
    await expect(withRetry(dead, constant({ maxRetries: 2 })).complete(req)).rejects.toThrow("down");
    expect(calls).toBe(3); // initial + 2 retries
  });

  it("waits at least the error's retryAfterMs before retrying", async () => {
    let calls = 0;
    const limited: LanguageModel = {
      name: "limited",
      complete: async () => {
        calls++;
        if (calls === 1) throw new NolaProviderError("429", { status: 429, retryAfterMs: 60 });
        return { text: "ok" };
      },
    };
    const start = Date.now();
    const p = withRetry(limited, exponential({ maxRetries: 1, delayMs: 0 }));
    expect((await p.complete(req)).text).toBe("ok");
    expect(Date.now() - start).toBeGreaterThanOrEqual(50);
  });

  it("caps the retry-after wait at the policy's maxDelayMs", async () => {
    let calls = 0;
    const hostile: LanguageModel = {
      name: "hostile",
      complete: async () => {
        calls++;
        if (calls === 1) throw new NolaProviderError("429", { status: 429, retryAfterMs: 60_000 });
        return { text: "ok" };
      },
    };
    const start = Date.now();
    const p = withRetry(hostile, exponential({ maxRetries: 1, delayMs: 0, maxDelayMs: 50 }));
    expect((await p.complete(req)).text).toBe("ok");
    expect(Date.now() - start).toBeLessThan(1_000);
  });

  it("exponential() fills documented defaults", () => {
    expect(exponential({ maxRetries: 3 })).toEqual({ maxRetries: 3, delayMs: 200, multiplier: 2, maxDelayMs: 10_000 });
  });

  it("names itself retry(<inner>)", () => {
    expect(withRetry(succeeding("x", "t"), constant({ maxRetries: 1 })).name).toBe("retry(x)");
  });
});

describe("fallback", () => {
  it("returns the first success and skips failed legs (even definitive ones)", async () => {
    const p = fallback([failing("a", new NolaProviderError("401", { status: 401 })), succeeding("b", "from-b")]);
    expect((await p.complete(req)).text).toBe("from-b");
    expect(p.name).toBe("fallback(a, b)");
  });

  it("aggregates every failure in the final error", async () => {
    const p = fallback([failing("a", new Error("one")), failing("b", new Error("two"))]);
    const err = (await p.complete(req).catch((e: unknown) => e)) as Error;
    expect(err).toBeInstanceOf(NolaProviderError);
    expect(err.message).toMatch(/a: one/);
    expect(err.message).toMatch(/b: two/);
  });

  it("rejects an empty list at construction", () => {
    expect(() => fallback([])).toThrow(/at least one model/);
  });
});

describe("roundRobin", () => {
  it("rotates the starting provider per call", async () => {
    const p = roundRobin([succeeding("a", "1"), succeeding("b", "2")]);
    expect((await p.complete(req)).text).toBe("1");
    expect((await p.complete(req)).text).toBe("2");
    expect((await p.complete(req)).text).toBe("1");
  });

  it("falls through failing legs within one rotation", async () => {
    const p = roundRobin([failing("a", new Error("down")), succeeding("b", "2")]);
    expect((await p.complete(req)).text).toBe("2");
  });

  it("rejects an empty list at construction", () => {
    expect(() => roundRobin([])).toThrow(/at least one model/);
  });
});

describe("platform-model rejection (a platform model can only be the root)", () => {
  const platform = (name: string): LanguageModel =>
    ({ [PLATFORM_MODEL]: true, name, infer: async () => ({ text: "m" }) }) as unknown as LanguageModel;

  it("withRetry refuses the platform model, pointing at nola.infer({ retry })", () => {
    expect(() => withRetry(platform("nola"), constant({ maxRetries: 1 }))).toThrow(NolaConfigError);
    expect(() => withRetry(platform("nola"), constant({ maxRetries: 1 }))).toThrow(/nola\.infer\(\{ retry \}\)/);
    expect(() => withRetry(platform("nola"), constant({ maxRetries: 1 }))).toThrow(/can only be the root/);
  });

  it("fallback and roundRobin refuse platform members", () => {
    expect(() => fallback([platform("a"), platform("b")])).toThrow(NolaConfigError);
    expect(() => roundRobin([platform("a")])).toThrow(NolaConfigError);
    expect(() => fallback([platform("nola"), succeeding("openai", "1")])).toThrow(/can only be the root/);
  });

  it("classic models keep the full combinator toolbox, unbranded results", () => {
    expect(isPlatformModel(withRetry(succeeding("x", "t"), constant({ maxRetries: 0 })))).toBe(false);
    expect(isPlatformModel(fallback([succeeding("a", "1"), succeeding("b", "2")]))).toBe(false);
    expect(isPlatformModel(roundRobin([succeeding("a", "1"), succeeding("b", "2")]))).toBe(false);
  });
});
