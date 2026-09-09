import type {
  NolaAccountResponse,
  NolaBillingSessionResponse,
  NolaCapabilitiesResponse,
  NolaClaimResponse,
  NolaConsoleCreatedKeyResponse,
  NolaConsoleMeResponse,
  NolaErrorResponse,
  NolaInferRequest,
  NolaTrialResponse,
} from "@nola-lang/core";
import {
  NOLA_API_URL,
  NOLA_PROTOCOL,
  NOLA_USAGE_HEADERS,
  NolaProviderError,
  redactError,
  redactSecrets,
} from "@nola-lang/core";
import { describe, expect, expectTypeOf, it } from "vitest";

describe("nola-protocol wire contract", () => {
  it("model is optional on the infer envelope — absent means the server chooses", () => {
    const withoutModel: NolaInferRequest = {
      protocol: NOLA_PROTOCOL,
      version: "0.0.0",
      intent: { intent: "extract", input: { instruction: "p" }, output: { syntax: "json" } },
    };
    expect(withoutModel.model).toBeUndefined();
    expectTypeOf<NolaInferRequest["model"]>().toEqualTypeOf<string | undefined>();
  });

  it("names the base URL and the usage headers once", () => {
    expect(NOLA_API_URL).toBe("https://api.nola.sh");
    expect(NOLA_USAGE_HEADERS).toEqual({ used: "x-nola-runs-used", limit: "x-nola-runs-limit", balance: "x-nola-balance-micro" });
  });

  it("types the trial, account, billing-session and error bodies", () => {
    const trial: NolaTrialResponse = {
      apiKey: "nola_sk_x",
      account: { id: "acct_1", kind: "anonymous" },
      trial: { runs: 25 },
    };
    const account: NolaAccountResponse = {
      id: "acct_1",
      kind: "anonymous",
      status: "active",
      trial: { runsUsed: 18, runsLimit: 25 },
    };
    const session: NolaBillingSessionResponse = {
      url: "https://nola.sh/billing/session/bill_1",
      expiresAt: "2026-08-24T00:00:00Z",
    };
    const error: NolaErrorResponse = {
      error: { code: "quota_exceeded", message: "…", details: { runsUsed: 25, runsLimit: 25 } },
    };
    expect([trial, account, session, error]).toHaveLength(4);
    expectTypeOf<NolaTrialResponse["account"]["kind"]>().toEqualTypeOf<"anonymous" | "user">();
  });

  it("types the CLI sign-in surface: capabilities.auth, console key / me / claim", () => {
    const caps: NolaCapabilitiesResponse = {
      protocol: NOLA_PROTOCOL,
      ingest: false,
      auth: { issuer: "https://nola.eu.auth0.com", clientId: "cli", audience: "https://api.nola.sh" },
      consoleUrl: "https://platform.nola.sh",
    };
    const key: NolaConsoleCreatedKeyResponse = { id: "key_1", name: "cli", prefix: "nola_sk_ab", suffix: "cdef1234", apiKey: "nola_sk_…" };
    const me: NolaConsoleMeResponse = {
      user: { id: "usr_1", email: "dev@example.com", name: null, avatarUrl: null },
      account: {
        id: "acct_1",
        kind: "user",
        status: "active",
        mode: "trial",
        trial: { runsUsed: 3, runsLimit: 25 },
        balanceMicro: 0,
        spendThisMonthMicro: 0,
        liveKeyCount: 1,
      },
    };
    const claim: NolaClaimResponse = { outcome: "merged", accountId: "acct_1" };
    expect([caps, key, me, claim]).toHaveLength(4);
    expectTypeOf<NolaCapabilitiesResponse["auth"]>().toEqualTypeOf<
      { issuer: string; clientId: string; audience: string } | undefined
    >();
  });
});

describe("NolaProviderError server fields", () => {
  it("carries the server's code and details and keeps them through redactError", () => {
    const err = new NolaProviderError("Nola trial quota reached.", {
      status: 402,
      code: "quota_exceeded",
      details: { runsUsed: 25, runsLimit: 25 },
      definitive: true,
    });
    expect(err.code).toBe("quota_exceeded");
    expect(err.details).toEqual({ runsUsed: 25, runsLimit: 25 });
    expect(err.status).toBe(402);
    expect(redactError(err)).toBe("Nola trial quota reached.");
  });

  it("leaves code and details undefined when not given", () => {
    const err = new NolaProviderError("x", { status: 500 });
    expect(err.code).toBeUndefined();
    expect(err.details).toBeUndefined();
  });
});

describe("redactSecrets", () => {
  it("treats nola_sk_ keys as secrets", () => {
    expect(redactSecrets(`key nola_sk_${"a".repeat(40)} here`)).toBe("key [redacted] here");
  });
});

describe("console wire types", () => {
  it("pins the ingest envelope version and the eight hook-event kinds", async () => {
    const { NOLA_INGEST_KINDS, NOLA_INGEST_VERSION } = await import("@nola-lang/core");
    expect(NOLA_INGEST_VERSION).toBe(1);
    expect(NOLA_INGEST_KINDS).toEqual([
      "askStart",
      "providerRequest",
      "providerResponse",
      "validationFailed",
      "retry",
      "askEnd",
      "invocationStart",
      "invocationEnd",
    ]);
  });

  it("types the envelope and capabilities reply", () => {
    const envelope: import("@nola-lang/core").NolaIngestEnvelope = {
      v: 1,
      runId: "r",
      pid: 1,
      seq: 0,
      at: Date.now(),
      kind: "askStart",
      event: {},
    };
    const caps: import("@nola-lang/core").NolaCapabilitiesResponse = { protocol: 1, ingest: true, profiles: ["fast"] };
    expect(envelope.kind).toBe("askStart");
    expect(caps.ingest).toBe(true);
  });
});
