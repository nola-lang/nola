import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Frame } from "@nola-lang/runtime";
import { __nola, nolaRuntime } from "@nola-lang/runtime";
import { afterEach, describe, expect, it } from "vitest";

afterEach(() => nolaRuntime.reset());

/** Configure a probe provider capturing each request payload (inline object so
 * NolaProvider contextual typing applies, as in stack-frames.test.ts). */
function configureProbe(payloads: string[]) {
  nolaRuntime.configure({
    providers: {
      default: {
        name: "probe",
        complete: async (req) => {
          payloads.push(req.messages[0]?.content ?? "");
          return { text: JSON.stringify(`v${payloads.length}`) };
        },
      },
    },
  });
}

function lowered() {
  const fileCtx = nolaRuntime.current().fileContext("x.tsi");
  const b = () =>
    __nola.intents.Intent(
      async (__ctx: Frame) =>
        await __nola.ask(
          __nola.intents.ExtractIntent({ instruction: "inner", type: { type: "string" }, loc: "5:3" }),
          __ctx,
        ),
      fileCtx.func({ fn: "b", instruction: "" }),
    );
  return { fileCtx, b };
}

describe("ask-site chaining (only ask wires context)", () => {
  it("bare thenable await inside a body does NOT inherit the caller's context", async () => {
    const payloads: string[] = [];
    configureProbe(payloads);
    const { fileCtx, b } = lowered();
    const a = () =>
      __nola.intents.Intent(
        async (__ctx: Frame) => {
          await __nola.ask(
            __nola.intents.ExtractIntent({ instruction: "first", type: { type: "string" }, loc: "2:3" }),
            __ctx,
          );
          return await b(); // bare await — no ask, no frame
        },
        fileCtx.func({ fn: "a", instruction: "" }),
      );
    await a();
    const bPayload = payloads[1] ?? "";
    expect(bPayload).toContain("CONTEXT — inside b(), x.tsi\n"); // rooted, not under a
    expect(bPayload).not.toContain("inside a()"); // no inherited caller context
    // TODO(history): assert no inherited previousExtractions once history composition lands.
  });

  it("an intent resolved inside a plain async helper roots as well", async () => {
    const payloads: string[] = [];
    configureProbe(payloads);
    const { fileCtx, b } = lowered();
    const helper = async () => await b(); // plain TS helper, no frame in sight
    const a = () =>
      __nola.intents.Intent(
        async (__ctx: Frame) => {
          await __nola.ask(
            __nola.intents.ExtractIntent({ instruction: "first", type: { type: "string" }, loc: "2:3" }),
            __ctx,
          );
          return await helper();
        },
        fileCtx.func({ fn: "a", instruction: "" }),
      );
    await a();
    const bPayload = payloads[1] ?? "";
    expect(bPayload).toContain("CONTEXT — inside b(), x.tsi\n");
    expect(bPayload).not.toContain("inside a()");
    // TODO(history): assert no inherited previousExtractions once history composition lands.
  });
});

describe("runtime portability", () => {
  it("runtime src does not import node:async_hooks", () => {
    const srcDir = fileURLToPath(new URL("../src", import.meta.url));
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (p.endsWith(".ts") && readFileSync(p, "utf8").includes("node:async_hooks")) offenders.push(p);
      }
    };
    walk(srcDir);
    expect(offenders).toEqual([]);
  });
});
