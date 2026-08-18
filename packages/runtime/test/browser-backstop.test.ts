import { Codes } from "@nola-lang/ast";
import { mockProvider } from "@nola-lang/providers";
import { nolaRuntime } from "@nola-lang/runtime";
import { afterEach, describe, expect, it } from "vitest";
import { openTestFrame } from "./helpers/frame.js";
import { askViaInference } from "./helpers/inference.js";

afterEach(() => {
  nolaRuntime.reset();
  delete (globalThis as Record<string, unknown>).window;
  delete (globalThis as Record<string, unknown>).document;
});

/** The smallest end-to-end ask: mock provider, one extract through the real path. */
function runOneMockAsk(): Promise<unknown> {
  nolaRuntime.configure({ providers: { default: mockProvider(["hello"]) } });
  return askViaInference({ frame: openTestFrame(), prompt: "p", schema: { type: "string" }, loc: "1:1" });
}

describe("browser backstop", () => {
  it("a browser-looking context makes any ask throw NOLA3013 (server-only v0)", async () => {
    (globalThis as Record<string, unknown>).window = {};
    (globalThis as Record<string, unknown>).document = {};
    await expect(runOneMockAsk()).rejects.toMatchObject({ code: Codes.BrowserExecutionUnsupported });
  });

  it("a plain Node context is unaffected", async () => {
    await expect(runOneMockAsk()).resolves.toBe("hello");
  });
});
