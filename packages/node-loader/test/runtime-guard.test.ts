import { Codes } from "@nola-lang/ast";
import { describe, expect, it } from "vitest";
import { assertNodeModuleHooks } from "../src/register.js";

describe("assertNodeModuleHooks", () => {
  it("accepts Node", () => {
    expect(() => assertNodeModuleHooks({ node: "22.21.1" })).not.toThrow();
  });

  it("refuses Bun with NOLA3015 and points at the working invocations", () => {
    expect(() => assertNodeModuleHooks({ node: "24.3.0", bun: "1.3.14" })).toThrow(
      new RegExp(`${Codes.LoaderHooksUnsupported}.*Bun.*bun run start.*node --import nola-lang/register`, "s"),
    );
  });

  it("refuses Deno the same way", () => {
    expect(() => assertNodeModuleHooks({ node: "22.0.0", deno: "2.0.0" })).toThrow(Codes.LoaderHooksUnsupported);
  });
});
