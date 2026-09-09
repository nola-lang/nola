import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Codes } from "@nola-lang/ast";
import { isPlatformModel, PLATFORM_MODEL } from "@nola-lang/core";
import { mockProvider, record, replay } from "@nola-lang/providers";
import type { Frame } from "@nola-lang/runtime";
import { __nola, fingerprintRequest, NolaConfigError, NolaProviderError, nolaRuntime } from "@nola-lang/runtime";
import { afterEach, describe, expect, it } from "vitest";
import { requestOf } from "./helpers/model.js";

/** An obviously fake key that still has a real key's shape (nothing key-shaped is committed as a literal). */
const FAKE_KEY = `sk-proj-${"A".repeat(24)}`;

afterEach(() => nolaRuntime.reset());

const ledgerIn = () => join(mkdtempSync(join(tmpdir(), "nola-ledger-")), "ledger.jsonl");

describe("record()", () => {
  it("passes through and appends a JSONL entry keyed by the RAW request fingerprint, content redacted", async () => {
    const path = ledgerIn();
    const inner = mockProvider([{ ok: 1 }]);
    const provider = record(inner, path);
    expect(provider.name).toBe("record(mock)");

    const req = requestOf({
      system: `sys with key ${FAKE_KEY}`,
      instruction: `hello ${FAKE_KEY}`,
      schema: {
        type: "object",
        properties: { ok: { type: "number" } },
        required: ["ok"],
        additionalProperties: false,
      },
    });
    const res = await provider.complete(req);
    expect(res.text).toBe('{"ok":1}');

    const lines = readFileSync(path, "utf8").trim().split("\n");
    expect(lines).toHaveLength(1);
    const entry = JSON.parse(lines[0] ?? "");
    expect(entry.fingerprint).toBe(fingerprintRequest(req)); // computed from RAW request
    expect(entry.fingerprint).toMatch(/^[0-9a-f]{64}$/); // and NOT itself redacted
    // the ledger stores the payload as sent — a classic provider recorded its rendered prompt
    expect(entry.request.payload.system).toContain("[redacted]");
    expect(entry.request.payload.messages[0].content).toContain("[redacted]");
    expect(JSON.stringify(entry.request.payload)).not.toContain("AbCd1234");
    expect(entry.response.text).toBe('{"ok":1}');
  });

  it("mirrors a platform inner: record(platform) is a branded platform model exposing infer, no complete", async () => {
    const path = ledgerIn();
    const platformInner = {
      [PLATFORM_MODEL]: true as const,
      name: "m",
      infer: async () => ({ text: '"managed-recorded"' }),
    };
    const wrapped = record(platformInner as never, path) as unknown as {
      name: string;
      infer?: (req: { model: unknown }) => Promise<{ text: string }>;
      complete?: unknown;
    };
    expect(isPlatformModel(wrapped)).toBe(true);
    expect(wrapped.name).toBe("record(m)");
    expect(wrapped.complete).toBeUndefined();
    const model = requestOf({ instruction: "managed ask", dialect: "model" }).payload;
    const res = await wrapped.infer?.({ model });
    expect(res?.text).toBe('"managed-recorded"');
    // the ledger line is keyed identically to a classic recording of the same ask
    const entry = JSON.parse(readFileSync(path, "utf8").trim());
    expect(entry.fingerprint).toBe(fingerprintRequest(requestOf({ instruction: "managed ask", dialect: "model" })));
    // …and replays through the classic replay() path
    expect((await replay(path).complete(requestOf({ instruction: "managed ask" }))).text).toBe('"managed-recorded"');
  });

  it("appends one line per completion", async () => {
    const path = ledgerIn();
    const provider = record(mockProvider(["a", "b"]), path);
    await provider.complete(requestOf({ instruction: "1" }));
    await provider.complete(requestOf({ instruction: "2" }));
    expect(readFileSync(path, "utf8").trim().split("\n")).toHaveLength(2);
  });
});

describe("replay()", () => {
  it("full offline round-trip: an infer-function invocation recorded then replayed keyless", async () => {
    const path = ledgerIn();
    const invoke = () => {
      const fileCtx = nolaRuntime.current().fileContext("x.tsi");
      return __nola.intents.Intent(
        async (__ctx: Frame) => {
          const name = await __nola.ask(
            __nola.intents.ExtractIntent({ instruction: "name", type: { type: "string" }, loc: "1:1" }),
            __ctx,
          );
          const age = await __nola.ask(
            __nola.intents.ExtractIntent({ instruction: "age", type: { type: "number" }, loc: "2:1" }),
            __ctx,
          );
          return { name, age };
        },
        fileCtx.func({ fn: "person", instruction: "" }),
      );
    };

    nolaRuntime.configure({ model: { default: record(mockProvider(["Evgen", 38]), path) } });
    await expect(invoke()).resolves.toEqual({ name: "Evgen", age: 38 });

    nolaRuntime.reset();
    nolaRuntime.configure({ model: { default: replay(path) } }); // no mock, no keys — ledger only
    await expect(invoke()).resolves.toEqual({ name: "Evgen", age: 38 });
  });

  it("replays a recorded correction pair in FIFO order, not just the last line for the fingerprint", async () => {
    const path = ledgerIn();
    const invoke = () => {
      const fileCtx = nolaRuntime.current().fileContext("x.tsi");
      return __nola.intents.Intent(
        async (__ctx: Frame) =>
          __nola.ask(__nola.intents.ExtractIntent({ instruction: "name", type: { type: "string" }, loc: "1:1" }), __ctx),
        fileCtx.func({ fn: "person", instruction: "" }),
      );
    };

    // First reply (123) fails the string schema and triggers a correction retry; second ("ok") passes.
    nolaRuntime.configure({ model: { default: record(mockProvider([123, "ok"]), path) } });
    await expect(invoke()).resolves.toBe("ok");

    const lines = readFileSync(path, "utf8").trim().split("\n");
    expect(lines).toHaveLength(2);
    const [first, second] = lines.map((l) => JSON.parse(l as string));
    // Same fingerprint: fingerprintRequest strips `model.correction`, so an ask's
    // first attempt and its correction hash identically.
    expect(first.fingerprint).toBe(second.fingerprint);

    nolaRuntime.reset();
    let attempts = -1;
    nolaRuntime.configure({
      model: { default: replay(path) },
      telemetry: [{ onAskEnd: (e) => { attempts = e.receipt.attempts; } }],
    });
    await expect(invoke()).resolves.toBe("ok");
    // Had replay collapsed to the last line, this would resolve on attempt 1 with no retry.
    expect(attempts).toBe(2);
  });

  it("unknown fingerprint is a definitive provider error naming the mismatch code", async () => {
    const path = ledgerIn();
    writeFileSync(path, "", "utf8");
    const provider = replay(path);
    const err = await provider.complete(requestOf({ instruction: "never recorded" })).then(
      () => {
        throw new Error("expected throw");
      },
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(NolaProviderError);
    expect((err as NolaProviderError).definitive).toBe(true);
    expect((err as Error).message).toContain(Codes.ReplayFingerprintMismatch);
  });

  it("a malformed ledger fails at load with NOLA3007", () => {
    const path = ledgerIn();
    writeFileSync(path, "not json\n", "utf8");
    try {
      replay(path);
      throw new Error("expected throw");
    } catch (e) {
      expect(e).toBeInstanceOf(NolaConfigError);
      expect((e as NolaConfigError).code).toBe(Codes.ReplayLedgerInvalid);
    }
  });

  it("a missing ledger file fails at load with NOLA3007", () => {
    try {
      replay(join(tmpdir(), "nola-does-not-exist", "ledger.jsonl"));
      throw new Error("expected throw");
    } catch (e) {
      expect((e as NolaConfigError).code).toBe(Codes.ReplayLedgerInvalid);
    }
  });
});
