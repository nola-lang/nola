import { mockProvider } from "@nola-lang/providers";
import { __nola, NolaConfigError, nolaRuntime } from "@nola-lang/runtime";
import { afterEach, describe, expect, it } from "vitest";
import { openTestFrame } from "./helpers/frame.js";

const named = (name: string, reply: string) => ({ ...mockProvider(() => reply), name });

function intent() {
  return __nola.intents.ExtractIntent<string>({
    instruction: "value",
    type: { type: "string" },
    loc: "1:1",
  });
}

const ctx = () => openTestFrame({ data: { fn: "t", instruction: "" } });

afterEach(() => nolaRuntime.reset());

describe("__nola.ask provider alias (ask with <name> lowering)", () => {
  it("routes resolution through the named provider", async () => {
    nolaRuntime.configure({
      providers: { default: named("d", "from-default"), fast: named("f", "from-fast") },
    });
    await expect(__nola.ask(intent(), ctx(), "fast")).resolves.toBe("from-fast");
  });

  it("uses the default provider when no alias is given", async () => {
    nolaRuntime.configure({
      providers: { default: named("d", "from-default"), fast: named("f", "from-fast") },
    });
    await expect(__nola.ask(intent(), ctx())).resolves.toBe("from-default");
  });

  it("the ask-site alias wins over the intent's own .withProvider pin", async () => {
    nolaRuntime.configure({
      providers: {
        default: named("d", "from-default"),
        slow: named("s", "from-slow"),
        fast: named("f", "from-fast"),
      },
    });
    const pinned = intent().withProvider("slow");
    await expect(__nola.ask(pinned, ctx(), "fast")).resolves.toBe("from-fast");
  });

  it("forceProvider stays hermetic: it beats the ask-site alias", async () => {
    nolaRuntime.configure({
      providers: { default: named("d", "from-default"), fast: named("f", "from-fast"), mock: named("m", "from-mock") },
      forceProvider: "mock",
    });
    await expect(__nola.ask(intent(), ctx(), "fast")).resolves.toBe("from-mock");
  });

  it("an unknown alias rejects with ConfigUnknownProvider at resolve time", async () => {
    nolaRuntime.configure({ providers: { default: named("d", "from-default") } });
    await expect(__nola.ask(intent(), ctx(), "slow")).rejects.toThrow(NolaConfigError);
  });
});
