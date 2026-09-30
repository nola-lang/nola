import { Codes } from "@nola-lang/ast";
import type { InferRequest, InferResult, LanguageModel } from "@nola-lang/core";
import { DECISION_MODEL, isDecisionModel, isPlatformModel, NolaConfigError, NolaProviderError } from "@nola-lang/core";
import { isDecisionRequest } from "./decision-request.js";
import { requireInfer } from "./require-infer.js";

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

function requireModels(models: LanguageModel[], combinator: string): void {
  if (models.length === 0) {
    throw new NolaConfigError(`${combinator}([]) needs at least one model.`, Codes.ConfigInvalid);
  }
}

/**
 * The platform model can only be the config root (platform-config design
 * 2026-09-03) — it manages its own resilience: built-in transport retry via
 * nola.infer({ retry }); routing and failover live on the server side.
 * record()/replay() remain available around it.
 */
function rejectPlatformModel(models: LanguageModel[], combinator: string): void {
  const rejected = models.filter((m) => isPlatformModel(m));
  if (rejected.length > 0) {
    throw new NolaConfigError(
      `${combinator}() cannot wrap ${rejected.map((m) => m.name).join(", ")} — the platform model can only be the root: it manages its own resilience (nola.infer({ retry }) for transport retry; routing and failover live on the server). record()/replay() remain available.`,
      Codes.ConfigInvalid,
    );
  }
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Build the outer model of a combinator: branded a decision model iff any inner is; `run` receives the request as is. */
function outer(name: string, inners: LanguageModel[], run: (req: InferRequest) => Promise<InferResult>): LanguageModel {
  const brand = inners.some((m) => isDecisionModel(m)) ? { [DECISION_MODEL]: true as const } : {};
  return { name, ...brand, infer: (req: InferRequest) => run(req) };
}

/**
 * Wire-level retry: re-attempts the single provider call with backoff,
 * fail-fasting on definitive errors. Honors the provider's `retryAfterMs`
 * (Retry-After) when it exceeds the scheduled delay, capped at
 * `policy.maxDelayMs` — so a policy whose maxDelayMs is 0 (e.g. `constant()`
 * with no delay) ignores the header entirely. Distinct from the intent method
 * `.withRetry(n)`, which flat-retries the entire ask (composition, provider
 * call, parse, validation) with no backoff and no definitive-error check.
 * Forwards `infer` and carries the inner's decision brand.
 */
export function withRetry(provider: LanguageModel, policy: RetryPolicy): LanguageModel {
  requireInfer([provider], "withRetry");
  rejectPlatformModel([provider], "withRetry");
  const inner = provider;
  return outer(`retry(${provider.name})`, [inner], async (req) => {
    let delay = policy.delayMs;
    let lastError: unknown;
    for (let attempt = 0; attempt <= policy.maxRetries; attempt++) {
      try {
        return await inner.infer(req);
      } catch (error) {
        lastError = error;
        if (isDefinitiveProviderError(error) || attempt === policy.maxRetries) throw error;
        const retryAfterMs = error instanceof NolaProviderError ? (error.retryAfterMs ?? 0) : 0;
        await sleep(Math.min(Math.max(delay, retryAfterMs), policy.maxDelayMs));
        delay = Math.min(delay * policy.multiplier, policy.maxDelayMs);
      }
    }
    throw lastError; // unreachable; satisfies control-flow analysis
  });
}

/** Try each inner in order; on a decision request, unbranded inners are skipped (they would fabricate). */
async function tryInOrder(name: string, ordered: LanguageModel[], req: InferRequest): Promise<InferResult> {
  const decision = isDecisionRequest(req);
  const failures: string[] = [];
  for (const p of ordered) {
    if (decision && !isDecisionModel(p)) {
      failures.push(`${p.name}: not a decision model`);
      continue;
    }
    try {
      return await p.infer(req);
    } catch (error) {
      failures.push(`${p.name}: ${describeError(error)}`);
    }
  }
  throw new NolaProviderError(`${name}: all providers failed —\n  ${failures.join("\n  ")}`);
}

export function fallback(providers: LanguageModel[]): LanguageModel {
  requireModels(providers, "fallback");
  requireInfer(providers, "fallback");
  rejectPlatformModel(providers, "fallback");
  const inners = providers;
  const name = `fallback(${providers.map((p) => p.name).join(", ")})`;
  return outer(name, inners, (req) => tryInOrder(name, inners, req));
}

export function roundRobin(providers: LanguageModel[]): LanguageModel {
  requireModels(providers, "roundRobin");
  requireInfer(providers, "roundRobin");
  rejectPlatformModel(providers, "roundRobin");
  const inners = providers;
  const name = `roundRobin(${providers.map((p) => p.name).join(", ")})`;
  let nextStart = 0;
  return outer(name, inners, (req) => {
    const start = nextStart++ % inners.length;
    const ordered = inners.map((_, i) => inners[(start + i) % inners.length] as LanguageModel);
    return tryInOrder(name, ordered, req);
  });
}
