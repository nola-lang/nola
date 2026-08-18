import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Codes } from "@nola-lang/ast";
import { mockProvider, record, replay } from "@nola-lang/providers";
import type { Frame } from "@nola-lang/runtime";
import { __nola, fingerprintRequest, NolaConfigError, NolaProviderError, nolaRuntime } from "@nola-lang/runtime";
import { afterEach, describe, expect, it } from "vitest";

afterEach(() => nolaRuntime.reset());

const ledgerIn = () => join(mkdtempSync(join(tmpdir(), "nola-ledger-")), "ledger.jsonl");

describe("record()", () => {
  it("passes through and appends a JSONL entry keyed by the RAW request fingerprint, content redacted", async () => {
    const path = ledgerIn();
    const inner = mockProvider([{ ok: 1 }]);
    const provider = record(inner, path);
    expect(provider.name).toBe("record(mock)");

    const req = {
      system: "sys with key sk-proj-AbCd1234EfGh5678IjKl",
      messages: [{ role: "user" as const, content: "hello sk-proj-AbCd1234EfGh5678IjKl" }],
      schema: {
        type: "object",
        properties: { ok: { type: "number" } },
        required: ["ok"],
        additionalProperties: false,
      } as const,
    };
    const res = await provider.complete(req);
    expect(res.text).toBe('{"ok":1}');

    const lines = readFileSync(path, "utf8").trim().split("\n");
    expect(lines).toHaveLength(1);
    const entry = JSON.parse(lines[0] ?? "");
    expect(entry.fingerprint).toBe(fingerprintRequest(req)); // computed from RAW request
    expect(entry.fingerprint).toMatch(/^[0-9a-f]{64}$/); // and NOT itself redacted
    expect(entry.request.system).toContain("[redacted]");
    expect(entry.request.messages[0].content).toContain("[redacted]");
    expect(entry.request.system).not.toContain("AbCd1234");
    expect(entry.response.text).toBe('{"ok":1}');
  });

  it("appends one line per completion", async () => {
    const path = ledgerIn();
    const provider = record(mockProvider(["a", "b"]), path);
    await provider.complete({ system: "s", messages: [{ role: "user", content: "1" }] });
    await provider.complete({ system: "s", messages: [{ role: "user", content: "2" }] });
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

    nolaRuntime.configure({ providers: { default: record(mockProvider(["Evgen", 38]), path) } });
    await expect(invoke()).resolves.toEqual({ name: "Evgen", age: 38 });

    nolaRuntime.reset();
    nolaRuntime.configure({ providers: { default: replay(path) } }); // no mock, no keys — ledger only
    await expect(invoke()).resolves.toEqual({ name: "Evgen", age: 38 });
  });

  it("unknown fingerprint is a definitive provider error naming the mismatch code", async () => {
    const path = ledgerIn();
    writeFileSync(path, "", "utf8");
    const provider = replay(path);
    const err = await provider.complete({ system: "s", messages: [{ role: "user", content: "never recorded" }] }).then(
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
