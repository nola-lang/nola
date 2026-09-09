import type { ProviderParams } from "./index.js";
import type { InferenceModel } from "./inference-model.js";

/**
 * The hosted API wire contract. Lives in core so the platform (server) side
 * imports the very same shapes the `nola()` provider and the scaffolder
 * send; nothing here depends on the runtime or the providers.
 */

/** Wire envelope version of POST /v1/infer. */
export const NOLA_PROTOCOL = 1;

/** Default base URL of the hosted API; `NOLA_API_URL` overrides it in every client. */
export const NOLA_API_URL = "https://api.nola.sh";

/**
 * Reply headers on POST /v1/infer. The run counter is sent in every mode (credit is spent first, the
 * free runs take over when it is gone); `balance` is present only while the account is in paid mode.
 */
export const NOLA_USAGE_HEADERS = { used: "x-nola-runs-used", limit: "x-nola-runs-limit", balance: "x-nola-balance-micro" } as const;

/** GET /v1/capabilities — every Nola-protocol server self-describes (console design §6). */
export interface NolaCapabilitiesResponse {
  protocol: typeof NOLA_PROTOCOL;
  /** Whether this server serves POST /v1/infer. Absent (legacy servers) is read as true. */
  infer?: boolean;
  /** Whether this server accepts POST /v1/ingest trace ingestion. */
  ingest: boolean;
  /** Inference profiles this server resolves (defined in the console UI); absent when it resolves none. */
  profiles?: readonly string[];
  /** How a CLI signs in against this server; absent when sign-in is not offered (console API off, no CLI client). */
  auth?: NolaAuthConfig;
  /** The console origin (`https://platform.nola.sh`) — billing page, account; absent on servers without a console. */
  consoleUrl?: string;
}

/** Envelope version of POST /v1/ingest. */
export const NOLA_INGEST_VERSION = 1;

/** The eight runtime hook events; kind names are the NolaTelemetry method names minus the `on` prefix. */
export const NOLA_INGEST_KINDS = [
  "askStart",
  "providerRequest",
  "providerResponse",
  "validationFailed",
  "retry",
  "askEnd",
  "invocationStart",
  "invocationEnd",
] as const;

export type NolaIngestKind = (typeof NOLA_INGEST_KINDS)[number];

/**
 * One POST /v1/ingest body — one hook event, fire-and-forget (console design
 * §11). `event` is the core hook event exactly as emitted, JSON-serialized
 * (a `Site` serializes structurally to `{ file, loc }`); consumers narrow by
 * `kind`. `seq` is a monotonic per-process counter — POSTs arrive out of
 * order and consumers order by it. `runId` is one UUID minted per process.
 */
export interface NolaIngestEnvelope {
  v: typeof NOLA_INGEST_VERSION;
  runId: string;
  pid: number;
  /** The app's project name (config `project`, defaulting to the nearest package.json `name`). Additive since 2026-09-01. */
  project?: string;
  seq: number;
  /** Date.now() at emit time. */
  at: number;
  kind: NolaIngestKind;
  event: unknown;
}

export interface NolaInferRequest {
  protocol: typeof NOLA_PROTOCOL;
  /** the client's lockstep package version — the server renders with the matching classic template */
  version: string;
  /** ask identity for tracing — present together, exactly when the runtime supplied `ProviderRequest.trace` */
  askId?: string;
  invocationId?: string;
  spanPath?: readonly string[];
  /** the ask itself — the canonical InferenceModel */
  intent: InferenceModel;
  /** upstream model selector, "<provider>/<model>" — absent ⇒ the server chooses (trial keys are restricted server-side) */
  model?: string;
  /**
   * Free-form inference profile — the `ask with <name>` name under managed
   * mode (`model: nola.infer()`). The platform's smart routing resolves it to a
   * model and params; unknown to the client by design. Additive since
   * 2026-08-30.
   */
  profile?: string;
  /** The app's project name — deployment metadata for per-project display/metering. Additive since 2026-09-01. */
  project?: string;
  params?: ProviderParams;
}

export interface NolaInferResponse {
  /** the model's raw reply; the runtime parses, validates and corrects it like any provider's */
  text: string;
  durationMs?: number;
}

/** Every non-2xx body. `details` is a JSON object; `quota_exceeded` carries `{ runsUsed, runsLimit }`. */
export interface NolaErrorResponse {
  error: { code: string; message: string; details?: Record<string, unknown> };
}

export type NolaAccountKind = "anonymous" | "user";

/**
 * POST /v1/trial — no auth, no body fields (the client sends `{}`; nothing
 * on the machine identifies it to the server). 201 with a fresh anonymous
 * account and its one key; the raw key appears here exactly once. One per
 * machine as far as the CLI is concerned — every later key needs a signed-in
 * user (spec 2026-09-04-cli-sign-in-design.md).
 */
export interface NolaTrialResponse {
  apiKey: string;
  account: { id: string; kind: NolaAccountKind };
  trial: { runs: number };
}

/** The `/authorize` query parameter the CLI uses to hand its recorded trial account id to the tenant's post-login Action. */
export const NOLA_ACCOUNT_PARAM = "ext-nola_account";
/** The access-token claim the Action writes from that parameter; the API claims the account from it (platform spec 2026-09-07). */
export const NOLA_ACCOUNT_CLAIM = "nola:account_id";

/** Where a CLI signs in (from GET /v1/capabilities): the Auth0 tenant as `https://<domain>`, the CLI's public client id, the API audience. */
export interface NolaAuthConfig {
  issuer: string;
  clientId: string;
  audience: string;
  /**
   * Loopback ports registered on the tenant as `http://127.0.0.1:<port>/callback` for the
   * Authorization Code + PKCE flow; the CLI binds the first free one. Absent or empty means
   * this server cannot sign a CLI in.
   */
  redirectPorts?: readonly number[];
}

/** POST /v1/console/keys — 201 (Auth0 bearer). The raw key appears here exactly once. */
export interface NolaConsoleCreatedKeyResponse {
  id: string;
  name: string | null;
  prefix: string;
  suffix: string | null;
  apiKey: string;
}

/** GET /v1/console/me — the signed-in user and their personal account (Auth0 bearer). */
export interface NolaConsoleMeResponse {
  user: { id: string; email: string | null; name: string | null; avatarUrl: string | null };
  account: {
    id: string;
    kind: NolaAccountKind;
    status: "active" | "suspended";
    mode: "trial" | "paid";
    trial: { runsUsed: number; runsLimit: number };
    balanceMicro: number;
    spendThisMonthMicro: number;
    liveKeyCount: number;
  };
}

/** POST /v1/console/sessions/:id/claim — links a project key's account (a `POST /v1/billing/session` session) to the signed-in user (Auth0 bearer). */
export interface NolaClaimResponse {
  outcome: "claimed" | "merged" | "already_owned";
  accountId: string;
}

/** GET /v1/account — Bearer auth. */
export interface NolaAccountResponse {
  id: string;
  kind: NolaAccountKind;
  status: "active" | "suspended";
  trial: { runsUsed: number; runsLimit: number };
  /** prepaid credits, in millionths of a US dollar */
  balance: { microUsd: number };
  /** The model hosted runs use and its retail price (micro-USD per million tokens) — what `nola account` prints. */
  model: NolaHostedModel;
}

/** The single hosted model (phase 1): a short display name and its price, both decided by the server. */
export interface NolaHostedModel {
  /** e.g. "gpt-oss-120b" */
  name: string;
  pricing: { inputMicroPerMTok: number; outputMicroPerMTok: number };
}

/** POST /v1/billing/session — Bearer auth, empty JSON body. The URL carries only a session id, never the key. */
export interface NolaBillingSessionResponse {
  url: string;
  /** ISO-8601 */
  expiresAt: string;
}
