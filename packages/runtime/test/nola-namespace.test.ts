import { mockProvider } from "@nola-lang/providers";
import { __nola, ExtractIntent, FunctionCallingIntent, nolaRuntime } from "@nola-lang/runtime";
import { afterEach, describe, expect, it } from "vitest";
import { Intent } from "../src/intents/intent.js";

afterEach(() => nolaRuntime.reset());

describe("__nola lowering namespace", () => {
  it("intent factories live under `intents` and mirror the class names", () => {
    expect(__nola.intents.ExtractIntent({ instruction: "m" })).toBeInstanceOf(ExtractIntent);
    expect(__nola.intents.FunctionCallingIntent({ fn: () => 1, name: "f", args: [] })).toBeInstanceOf(
      FunctionCallingIntent,
    );
    expect(__nola.intents.Intent(async () => 1, __nola.context.file("x.tsi").func({ fn: "f" }))).toBeInstanceOf(Intent);
  });

  it("non-class helpers stay at the top level", () => {
    expect(typeof __nola.context.file).toBe("function");
    expect(typeof __nola.ask).toBe("function");
    expect(typeof __nola.fmt).toBe("function");
    expect("ExtractIntent" in __nola).toBe(false);
  });

  it("executes the spec's normative lowered shape end to end", async () => {
    nolaRuntime.configure({ providers: { default: mockProvider(["Evgen"]) } });
    // hand-written equivalent of lowering
    //   infer function getUser(m) { return ask ..`user ${m}`<string> }
    function getUser(m: string) {
      return __nola.intents.Intent(
        async (__ctx) => {
          const user = await __nola.ask(
            __nola.intents.ExtractIntent<string>({
              instruction: `user ${__nola.fmt(m)}`,
              type: { type: "string" },
              loc: "2:1",
            }),
            __ctx,
          );
          return user;
        },
        __nola.context.file("x.tsi").func({ fn: "getUser", instruction: "" }),
      );
    }
    const user = await getUser("hello").withRetry(1);
    expect(user).toBe("Evgen");
  });
});
