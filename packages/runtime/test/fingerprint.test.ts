import { canonicalize, fingerprintAsk, fingerprintRequest, sha256Hex } from "@nola-lang/runtime";
import { describe, expect, it } from "vitest";

describe("canonicalize", () => {
  it("sorts object keys recursively; arrays keep order", () => {
    expect(canonicalize({ b: 1, a: { d: 2, c: [3, { f: 4, e: 5 }] } })).toBe(
      '{"a":{"c":[3,{"e":5,"f":4}],"d":2},"b":1}',
    );
  });
});

describe("fingerprintAsk", () => {
  const base = {
    lineage: [{ file: "x.tsi" }, { fn: "go", instruction: "" }],
    history: [{ prompt: "earlier", value: 7 }],
    prompt: "user name",
    schema: { type: "string" } as const,
    provider: "mock",
    preamble: "PREAMBLE",
  };

  it("is stable (golden hash — FINGERPRINT_VERSION compatibility gate)", () => {
    // toMatchInlineSnapshot pins the exact hash on first run; any later
    // serialization change fails here and forces a FINGERPRINT_VERSION bump.
    // v3: fingerprintRequest gained output + params.
    expect(fingerprintAsk(base)).toMatchInlineSnapshot(
      `"84d2c125fcd47ffe6ffd2a1e5b64db2caa3191903b7414dffd2e29c891cce80d"`,
    );
  });

  it("is insensitive to object key order", () => {
    const reordered = { ...base, lineage: [{ file: "x.tsi" }, { instruction: "", fn: "go" }] };
    expect(fingerprintAsk(reordered)).toBe(fingerprintAsk(base));
  });

  it("history hashes promptValue ?? value (the prompt's view)", () => {
    const a = { ...base, history: [{ prompt: "p", value: { big: true }, promptValue: "summary" }] };
    const b = { ...base, history: [{ prompt: "p", value: "summary" }] };
    expect(fingerprintAsk(a)).toBe(fingerprintAsk(b));
  });

  it("changes when prompt, schema, provider, or history changes", () => {
    expect(fingerprintAsk({ ...base, prompt: "other" })).not.toBe(fingerprintAsk(base));
    expect(fingerprintAsk({ ...base, schema: { type: "number" } })).not.toBe(fingerprintAsk(base));
    expect(fingerprintAsk({ ...base, provider: "openai" })).not.toBe(fingerprintAsk(base));
    expect(fingerprintAsk({ ...base, history: [] })).not.toBe(fingerprintAsk(base));
  });
});

describe("fingerprintRequest", () => {
  it("keys on system + messages + output + params and is 64-char hex", () => {
    const req = {
      system: "s",
      messages: [{ role: "user" as const, content: "c" }],
      output: { syntax: "json" as const, schema: { type: "string" as const } },
    };
    expect(fingerprintRequest(req)).toMatch(/^[0-9a-f]{64}$/);
    expect(fingerprintRequest(req)).toBe(fingerprintRequest({ ...req }));
    expect(fingerprintRequest({ ...req, system: "t" })).not.toBe(fingerprintRequest(req));
    expect(fingerprintRequest({ ...req, output: { syntax: "json" } })).not.toBe(fingerprintRequest(req));
    expect(fingerprintRequest({ ...req, params: { temperature: 0 } })).not.toBe(fingerprintRequest(req));
  });
});

describe("sha256Hex", () => {
  it("known vector", () => {
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});
