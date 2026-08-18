import type { ProviderParams, ProviderRequest } from "@nola-lang/core";
import { ExtractIntent, fingerprintRequest, nolaRuntime } from "@nola-lang/runtime";
import { afterEach, describe, expect, it } from "vitest";
import { openTestFrame } from "./helpers/frame.js";

afterEach(() => nolaRuntime.reset());

/** Captures the params of every request it serves. */
function probeProvider(seen: (ProviderParams | undefined)[]) {
  return {
    name: "probe",
    complete: async (req: ProviderRequest) => {
      seen.push(req.params);
      return { text: '"ok"' };
    },
  };
}

const extract = () =>
  new ExtractIntent({ instruction: "p", type: { type: "string" }, loc: "1:1" }, nolaRuntime.current());

describe("ProviderParams", () => {
  it("withParams reaches the provider and shallow-merges across clones", async () => {
    const seen: (ProviderParams | undefined)[] = [];
    nolaRuntime.configure({ providers: { default: probeProvider(seen) } });
    const frame = openTestFrame();
    await extract().withParams({ temperature: 1 }).withParams({ maxOutputTokens: 5 }).run(frame);
    expect(seen).toEqual([{ temperature: 1, maxOutputTokens: 5 }]);
  });

  it("an outer frame's params cover callee asks; a nearer frame overrides per field", async () => {
    const seen: (ProviderParams | undefined)[] = [];
    nolaRuntime.configure({ providers: { default: probeProvider(seen) } });
    const frame = openTestFrame({ options: { params: { temperature: 1, maxOutputTokens: 9 } } });
    await extract().withParams({ temperature: 0 }).run(frame);
    expect(seen).toEqual([{ temperature: 0, maxOutputTokens: 9 }]);
  });

  it("no params anywhere means none on the wire", async () => {
    const seen: (ProviderParams | undefined)[] = [];
    nolaRuntime.configure({ providers: { default: probeProvider(seen) } });
    await extract().run(openTestFrame());
    expect(seen).toEqual([undefined]);
  });

  it("providerOptions merge per key across clones and frames", async () => {
    const seen: (ProviderParams | undefined)[] = [];
    nolaRuntime.configure({ providers: { default: probeProvider(seen) } });
    const frame = openTestFrame({
      options: { params: { providerOptions: { top_p: 0.5, reasoning: "low" } } },
    });
    await extract()
      .withParams({ providerOptions: { reasoning: "high" } })
      .withParams({ providerOptions: { seed: 7 } })
      .run(frame);
    expect(seen).toEqual([{ providerOptions: { top_p: 0.5, reasoning: "high", seed: 7 } }]);
  });

  it("params are part of the request fingerprint", () => {
    const base = {
      system: "s",
      messages: [{ role: "user" as const, content: "m" }],
      output: { syntax: "json" as const, schema: { type: "string" as const } },
    };
    const a = fingerprintRequest(base);
    const b = fingerprintRequest({ ...base, params: { temperature: 0 } });
    const c = fingerprintRequest({ ...base, params: { temperature: 1 } });
    expect(a).not.toBe(b);
    expect(b).not.toBe(c);
    expect(fingerprintRequest({ ...base, params: { providerOptions: { top_p: 0.5 } } })).not.toBe(a);
  });
});
