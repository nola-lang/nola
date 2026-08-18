import { Codes } from "@nola-lang/ast";
import type { NolaProvider } from "@nola-lang/core";
import { NolaConfigError, NolaProviderError } from "@nola-lang/core";

export interface RetryPolicy {
  maxRetries: number;
  delayMs: number;
  multiplier: number;
  maxDelayMs: number;
}

export function constant(opts: { maxRetries: number; delayMs?: number }): RetryPolicy {
  const delayMs = opts.delayMs ?? 0;
  return { maxRetries: opts.maxRetries, delayMs, multiplier: 1, maxDelayMs: delayMs };
}

export function exponential(opts: {
  maxRetries: number;
  delayMs?: number;
  multiplier?: number;
  maxDelayMs?: number;
}): RetryPolicy {
  return {
    maxRetries: opts.maxRetries,
    delayMs: opts.delayMs ?? 200,
    multiplier: opts.multiplier ?? 2,
    maxDelayMs: opts.maxDelayMs ?? 10_000,
  };
}

/** Definitive errors must not be retried: explicit flag, or HTTP 4xx except 408/429. */
export function isDefinitiveProviderError(error: unknown): boolean {
  if (!(error instanceof NolaProviderError)) return false;
  if (error.definitive) return true;
  const s = error.status;
  return s !== undefined && s >= 400 && s < 500 && s !== 408 && s !== 429;
}

function sleep(ms: number): Promise<void> {
  return ms <= 0 ? Promise.resolve() : new Promise((resolve) => setTimeout(resolve, ms));
}

function requireProviders(providers: NolaProvider[], combinator: string): void {
  if (providers.length === 0) {
    throw new NolaConfigError(`${combinator}([]) needs at least one provider.`, Codes.ConfigInvalid);
  }
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Wire-level retry: re-attempts the single `provider.complete` call with
 * backoff, fail-fasting on definitive errors. Honors the provider's
 * `retryAfterMs` (Retry-After) when it exceeds the scheduled delay, capped at
 * `policy.maxDelayMs` — so a policy whose maxDelayMs is 0 (e.g. `constant()`
 * with no delay) ignores the header entirely. Distinct from the intent method
 * `.withRetry(n)`, which flat-retries the entire ask (composition, provider
 * call, parse, validation) with no backoff and no definitive-error check.
 */
export function withRetry(provider: NolaProvider, policy: RetryPolicy): NolaProvider {
  return {
    name: `retry(${provider.name})`,
    async complete(req) {
      let delay = policy.delayMs;
      let lastError: unknown;
      for (let attempt = 0; attempt <= policy.maxRetries; attempt++) {
        try {
          return await provider.complete(req);
        } catch (error) {
          lastError = error;
          if (isDefinitiveProviderError(error) || attempt === policy.maxRetries) throw error;
          const retryAfterMs = error instanceof NolaProviderError ? (error.retryAfterMs ?? 0) : 0;
          await sleep(Math.min(Math.max(delay, retryAfterMs), policy.maxDelayMs));
          delay = Math.min(delay * policy.multiplier, policy.maxDelayMs);
        }
      }
      throw lastError; // unreachable; satisfies control-flow analysis
    },
  };
}

export function fallback(providers: NolaProvider[]): NolaProvider {
  requireProviders(providers, "fallback");
  const name = `fallback(${providers.map((p) => p.name).join(", ")})`;
  return {
    name,
    async complete(req) {
      const failures: string[] = [];
      for (const p of providers) {
        try {
          return await p.complete(req);
        } catch (error) {
          failures.push(`${p.name}: ${describeError(error)}`);
        }
      }
      throw new NolaProviderError(`${name}: all providers failed —\n  ${failures.join("\n  ")}`);
    },
  };
}

export function roundRobin(providers: NolaProvider[]): NolaProvider {
  requireProviders(providers, "roundRobin");
  const name = `roundRobin(${providers.map((p) => p.name).join(", ")})`;
  let nextStart = 0;
  return {
    name,
    async complete(req) {
      const start = nextStart++ % providers.length;
      const failures: string[] = [];
      for (let i = 0; i < providers.length; i++) {
        const p = providers[(start + i) % providers.length] as NolaProvider;
        try {
          return await p.complete(req);
        } catch (error) {
          failures.push(`${p.name}: ${describeError(error)}`);
        }
      }
      throw new NolaProviderError(`${name}: all providers failed —\n  ${failures.join("\n  ")}`);
    },
  };
}
