import type { ClassicPrompt, InferenceModel, InferenceScope } from "@nola-lang/core";
import { CORRECTION_PROMPT, canonicalize, FINGERPRINT_VERSION, fingerprintRequest, renderClassic, sha256Hex } from "@nola-lang/core";
import { describe, expect, it } from "vitest";

const model: InferenceModel = {
  intent: "extract",
  input: { instruction: "user name" },
  scope: { fn: "go", file: "x.tsi", instruction: "", args: [{ name: "m", type: "string", contextual: true, value: "v" }] },
  output: { syntax: "json", schema: { type: "string" } },
};

describe("fingerprintRequest (v5: over the classic rendering, whatever the payload dialect)", () => {
  it("is version 5 and 64-char hex", () => {
    expect(FINGERPRINT_VERSION).toBe(5);
    expect(fingerprintRequest({ payload: model })).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is stable (golden hash — FINGERPRINT_VERSION compatibility gate)", () => {
    // toMatchInlineSnapshot pins the exact hash on first run; a later serialization
    // change fails here and forces a FINGERPRINT_VERSION bump.
    expect(fingerprintRequest({ payload: model })).toMatchInlineSnapshot(`"688a0153a54d4b0df0f0eae61a0305a7f11cff60313bbce0273a41ae9e5a92d2"`);
  });

  it("keys a model and its classic rendering identically — one ledger serves nola() and chat providers alike", () => {
    expect(fingerprintRequest({ payload: renderClassic(model) })).toBe(fingerprintRequest({ payload: model }));
  });

  it("is insensitive to key order and to extra request fields (signal, trace)", () => {
    const reordered = { output: model.output, scope: model.scope, input: model.input, intent: model.intent } as InferenceModel;
    expect(fingerprintRequest({ payload: reordered })).toBe(fingerprintRequest({ payload: model }));
    expect(
      fingerprintRequest({ payload: model, signal: new AbortController().signal, trace: { askId: "a", invocationId: "i", spanPath: ["i"] } }),
    ).toBe(fingerprintRequest({ payload: model }));
  });

  it("changes with instruction, scope values, schema, system, template text, or params", () => {
    const base = fingerprintRequest({ payload: model });
    expect(fingerprintRequest({ payload: { ...model, input: { instruction: "other" } } })).not.toBe(base);
    const scope = model.scope as InferenceScope;
    expect(fingerprintRequest({ payload: { ...model, scope: { ...scope, args: [{ name: "m", type: "string", contextual: true, value: "w" }] } } })).not.toBe(base);
    expect(fingerprintRequest({ payload: { ...model, output: { syntax: "json", schema: { type: "number" } } } })).not.toBe(base);
    expect(fingerprintRequest({ payload: { ...model, system: "Be terse." } })).not.toBe(base);
    expect(fingerprintRequest({ payload: { ...model, input: { instruction: "user name", text: "override" } } })).not.toBe(base);
    expect(fingerprintRequest({ payload: model, params: { temperature: 0 } })).not.toBe(base);
    expect(fingerprintRequest({ payload: model, params: { providerOptions: { top_p: 0.5 } } })).not.toBe(base);
  });

  it("keys a profile distinctly, and only when present — profile-free asks keep their v5 hashes", () => {
    const base = fingerprintRequest({ payload: model });
    expect(fingerprintRequest({ payload: model, profile: "fast" })).not.toBe(base);
    expect(fingerprintRequest({ payload: model, profile: "fast" })).not.toBe(fingerprintRequest({ payload: model, profile: "careful" }));
    // absent and explicitly-undefined profile serialize identically — no ledger re-keying
    expect(fingerprintRequest({ payload: model, profile: undefined })).toBe(base);
  });

  it("ignores a model's correction turn — the ask's identity is the request as first composed", () => {
    expect(fingerprintRequest({ payload: { ...model, correction: { response: "x", error: "e" } } })).toBe(fingerprintRequest({ payload: model }));
  });

  it("ignores a classic prompt's correction turns the same way", () => {
    const first = renderClassic(model);
    const corrected: ClassicPrompt = {
      ...first,
      messages: [...first.messages, { role: "assistant", content: "x" }, { role: "user", content: CORRECTION_PROMPT("e") }],
    };
    expect(fingerprintRequest({ payload: corrected })).toBe(fingerprintRequest({ payload: first }));
    expect(fingerprintRequest({ payload: corrected })).toBe(fingerprintRequest({ payload: { ...model, correction: { response: "x", error: "e" } } }));
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
