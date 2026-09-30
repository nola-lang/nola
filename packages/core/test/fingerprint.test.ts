import type { InferenceModel, InferenceScope } from "@nola-lang/core";
import { canonicalize, DEFAULT_SYSTEM, FINGERPRINT_VERSION, fingerprintRequest, renderPrompt, sha256Hex } from "@nola-lang/core";
import { describe, expect, it } from "vitest";

const intent: InferenceModel = {
  intent: "extract",
  input: { instruction: "user name" },
  scope: { fn: "go", file: "x.tsi", instruction: "", args: [{ name: "m", type: "string", contextual: true, value: "v" }] },
  output: { syntax: "json", schema: { type: "string" } },
};

describe("fingerprintRequest (v6: over the intent — the ask as data, never its rendering)", () => {
  it("is version 6 and 64-char hex", () => {
    expect(FINGERPRINT_VERSION).toBe(6);
    expect(fingerprintRequest({ intent })).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is stable (golden hash — FINGERPRINT_VERSION compatibility gate)", () => {
    // toMatchInlineSnapshot pins the exact hash on first run; a later serialization
    // change fails here and forces a FINGERPRINT_VERSION bump.
    expect(fingerprintRequest({ intent })).toMatchInlineSnapshot(`"072dfa4d2b11291a4ce813bd80402c5871c90760ae637bf799176d7a9948c658"`);
  });

  it("does not depend on the rendering: the default system text is not hashed", () => {
    // renderPrompt's wording changes in stage 2 of the prompt-rendering spec; this hash must not.
    expect(renderPrompt(intent).system).toBe(DEFAULT_SYSTEM);
    expect(canonicalize({ v: FINGERPRINT_VERSION, intent, params: null })).not.toContain(DEFAULT_SYSTEM.slice(0, 20));
  });

  it("is insensitive to key order and to extra request fields (signal, trace, project)", () => {
    const reordered = { output: intent.output, scope: intent.scope, input: intent.input, intent: intent.intent } as InferenceModel;
    expect(fingerprintRequest({ intent: reordered })).toBe(fingerprintRequest({ intent }));
    expect(
      fingerprintRequest({
        intent,
        signal: new AbortController().signal,
        trace: { askId: "a", invocationId: "i", spanPath: ["i"] },
        project: "app",
      }),
    ).toBe(fingerprintRequest({ intent }));
  });

  it("changes with instruction, scope values, schema, system, template text, or params", () => {
    const base = fingerprintRequest({ intent });
    expect(fingerprintRequest({ intent: { ...intent, input: { instruction: "other" } } })).not.toBe(base);
    const scope = intent.scope as InferenceScope;
    expect(
      fingerprintRequest({ intent: { ...intent, scope: { ...scope, args: [{ name: "m", type: "string", contextual: true, value: "w" }] } } }),
    ).not.toBe(base);
    expect(fingerprintRequest({ intent: { ...intent, output: { syntax: "json", schema: { type: "number" } } } })).not.toBe(base);
    expect(fingerprintRequest({ intent: { ...intent, system: "Be terse." } })).not.toBe(base);
    expect(fingerprintRequest({ intent: { ...intent, input: { instruction: "user name", text: "override" } } })).not.toBe(base);
    expect(fingerprintRequest({ intent, params: { temperature: 0 } })).not.toBe(base);
    expect(fingerprintRequest({ intent, params: { providerOptions: { top_p: 0.5 } } })).not.toBe(base);
  });

  it("keys a profile distinctly, and only when present", () => {
    const base = fingerprintRequest({ intent });
    expect(fingerprintRequest({ intent, profile: "fast" })).not.toBe(base);
    expect(fingerprintRequest({ intent, profile: "fast" })).not.toBe(fingerprintRequest({ intent, profile: "careful" }));
    expect(fingerprintRequest({ intent, profile: undefined })).toBe(base);
  });

  it("ignores the correction turn — the ask's identity is the intent as first composed", () => {
    expect(fingerprintRequest({ intent: { ...intent, correction: { response: "x", error: "e" } } })).toBe(fingerprintRequest({ intent }));
  });
});

describe("canonicalize / sha256Hex", () => {
  it("sorts object keys recursively; arrays keep order", () => {
    expect(canonicalize({ b: 1, a: { d: 2, c: [3, { f: 4, e: 5 }] } })).toBe('{"a":{"c":[3,{"e":5,"f":4}],"d":2},"b":1}');
  });
  it("known vector", () => {
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});
