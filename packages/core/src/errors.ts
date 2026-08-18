import type { InvocationTrace, Site } from "./index.js";

export class NolaConfigError extends Error {
  override name = "NolaConfigError";
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message);
  }
}

export interface ResolutionDetails {
  prompt: string;
  raw: string;
  site: Site;
}

export class NolaResolutionError extends Error {
  override name = "NolaResolutionError";
  /** execution trace of the failing invocation, stamped by the innermost frame */
  trace?: InvocationTrace;
  constructor(
    message: string,
    readonly details: ResolutionDetails,
    options?: { cause?: unknown },
  ) {
    super(message, options);
  }
}

/** An intent that carries no construction scope (extract/call) was resolved
 * outside `ask` — nothing can supply its frame. Definitive. */
export class NolaIntentError extends Error {
  override name = "NolaIntentError";
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
  }
}

/** A type that could not be derived reached an ask (companion `unsupported`). Definitive. */
export class NolaSchemaError extends Error {
  override name = "NolaSchemaError";
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
  }
}

export interface ProviderErrorOptions {
  status?: number;
  definitive?: boolean;
  /** provider-requested wait before retrying (Retry-After), in ms */
  retryAfterMs?: number;
  cause?: unknown;
}

export class NolaProviderError extends Error {
  override name = "NolaProviderError";
  readonly status?: number;
  readonly definitive?: boolean;
  readonly retryAfterMs?: number;
  constructor(message: string, options: ProviderErrorOptions = {}) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.status = options.status;
    this.definitive = options.definitive;
    this.retryAfterMs = options.retryAfterMs;
  }
}

export interface VersionDetails {
  expected: number;
  actual: number;
  direction?: "rebuild" | "update-runtime";
  urls?: [string, string];
}

export class NolaVersionError extends Error {
  override name = "NolaVersionError";
  constructor(
    message: string,
    readonly code: string,
    readonly details: VersionDetails,
  ) {
    super(message);
  }
}
