import { mockProvider } from "@nola-lang/providers";
import { nolaRuntime } from "@nola-lang/runtime";
import { afterEach, describe, expect, it } from "vitest";
import { openTestFrame } from "./helpers/frame.js";
import { askViaInference } from "./helpers/inference.js";

afterEach(() => nolaRuntime.reset());

// There is no strategy-selection layer for now — each intent constructs its
// Inference directly (ExtractIntent/FunctionCallingIntent → JsonInference).

describe("JsonInference.infer", () => {
  it("resolves the validated value", async () => {
    nolaRuntime.configure({ providers: { default: mockProvider(["Evgen"]) } });
    await expect(
      askViaInference({ frame: openTestFrame(), prompt: "user name", schema: { type: "string" }, loc: "1:1" }),
    ).resolves.toBe("Evgen");
  });

  it("retries once with the correction prompt, then succeeds", async () => {
    const seen: string[][] = [];
    nolaRuntime.configure({
      providers: {
        default: {
          name: "probe",
          complete: async (req) => {
            seen.push(req.messages.map((m) => m.content));
            return { text: seen.length === 1 ? "123" : '"ok"' };
          },
        },
      },
    });
    const v = await askViaInference({ frame: openTestFrame(), prompt: "p", schema: { type: "string" }, loc: "1:1" });
    expect(v).toBe("ok");
    // Second call: [original user, assistant echo, correction user].
    expect(seen[1]).toHaveLength(3);
    expect(seen[1]?.[2]).toBe(
      "Your previous reply was invalid: $: expected string, got number. Reply again with JSON strictly conforming to responseSchema.",
    );
  });

  it("rejects non-JSON replies with the parse error", async () => {
    nolaRuntime.configure({
      providers: { default: { name: "raw", complete: async () => ({ text: "not json" }) } },
    });
    await expect(
      askViaInference({ frame: openTestFrame(), prompt: "p", schema: { type: "string" }, loc: "3:7" }),
    ).rejects.toThrow(/reply is not valid JSON/);
  });
});
