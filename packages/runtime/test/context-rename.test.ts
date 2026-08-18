import { InferContext, nolaRuntime } from "@nola-lang/runtime";
import { describe, expect, it } from "vitest";

describe("InferContext rename", () => {
  it("InferContext is the class", () => {
    expect(nolaRuntime.current().fileContext("x.tsi")).toBeInstanceOf(InferContext);
  });

  it("the NolaContext, LlmContext, and LmContext prior names are gone (no aliases)", async () => {
    const mod = await import("@nola-lang/runtime");
    expect("NolaContext" in mod).toBe(false);
    expect("LlmContext" in mod).toBe(false);
    expect("LmContext" in mod).toBe(false);
  });
});
