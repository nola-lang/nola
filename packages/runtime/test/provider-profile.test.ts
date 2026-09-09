import { Codes } from "@nola-lang/ast";
import type { AskReceipt, ModelConfigEntry, ProviderRequest } from "@nola-lang/core";
import { isPlatformModel, NolaConfigError } from "@nola-lang/core";
import { mockProvider } from "@nola-lang/providers";
import { ExtractIntent, nola, nolaRuntime } from "@nola-lang/runtime";
import { afterEach, describe, expect, it } from "vitest";
import { openTestFrame } from "./helpers/frame.js";

afterEach(() => nolaRuntime.reset());

/** Captures every request it serves. */
function probeProvider(seen: ProviderRequest[]) {
  return {
    name: "probe",
    complete: async (req: ProviderRequest) => {
      seen.push(req);
      return { text: '"ok"' };
    },
  };
}

/** The platform model — the map's `default` in the forced-replay shape. */
const platform = (): ModelConfigEntry => nola.infer();

const extract = () =>
  new ExtractIntent({ instruction: "p", type: { type: "string" }, loc: "1:1" }, nolaRuntime.current());

describe("platform-model gate", () => {
  it("model: nola.infer() puts the platform model at default (config v2 §2)", () => {
    nolaRuntime.configure({ model: nola.infer(), telemetry: [] });
    const served = nolaRuntime.current().config?.model.default;
    expect(served && isPlatformModel(served)).toBe(true);
  });
});

describe("resolveModelProfile — free-form ask-site names when the platform serves", () => {
  it("an unconfigured name resolves to the platform default and carries the name as the profile", () => {
    nolaRuntime.configure({ model: nola.infer(), telemetry: [] });
    const { model, profile } = nolaRuntime.current().resolveModelProfile("fast");
    expect(model.name).toBe("nola");
    expect(profile).toBe("fast");
  });

  it("no pin and a configured name resolve exactly as before — no profile", () => {
    nolaRuntime.configure({ model: { default: platform(), mock: mockProvider(["x"]) } });
    const rt = nolaRuntime.current();
    expect(rt.resolveModelProfile(undefined)).toEqual({ model: rt.config?.model.default, profile: undefined });
    expect(rt.resolveModelProfile("mock")).toEqual({ model: rt.config?.model.mock, profile: undefined });
  });

  it("a model instance as the ref is used as-is, no profile", () => {
    nolaRuntime.configure({ model: nola.infer(), telemetry: [] });
    const inline = mockProvider(["x"]);
    expect(nolaRuntime.current().resolveModelProfile(inline)).toEqual({ model: inline, profile: undefined });
  });

  it("nola.infer(selector) keeps the platform serving — profiles apply", () => {
    nolaRuntime.configure({ model: nola.infer("openai/gpt-5-mini"), telemetry: [] });
    const { model, profile } = nolaRuntime.current().resolveModelProfile("fast");
    expect(model.name).toBe("nola");
    expect(profile).toBe("fast");
  });

  it("an unconfigured name under a LOCAL default stays NOLA3004", () => {
    nolaRuntime.configure({ model: mockProvider(["x"]) });
    let caught: unknown;
    try {
      nolaRuntime.current().resolveModelProfile("fast");
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(NolaConfigError);
    expect((caught as NolaConfigError).code).toBe(Codes.ConfigUnknownModel);
    expect((caught as NolaConfigError).message).toMatch(/"fast" does not name a configured model/);
    expect((caught as NolaConfigError).message).toMatch(/model: nola\.infer\(\)/);
  });

  it("forceModel still wins, and a platform default keeps the profile for record/replay parity", () => {
    const seen: ProviderRequest[] = [];
    nolaRuntime.configure({ model: { default: platform(), probe: probeProvider(seen) }, forceModel: "probe" });
    const { model, profile } = nolaRuntime.current().resolveModelProfile("fast");
    expect(model.name).toBe("probe");
    expect(profile).toBe("fast");
  });

  it("forceModel over a local default keeps today's behavior: forced model, no profile, no error", () => {
    nolaRuntime.configure({
      model: { default: mockProvider(["x"]), mock: mockProvider(["y"]) },
      forceModel: "mock",
    });
    const { model, profile } = nolaRuntime.current().resolveModelProfile("fast");
    expect(model.name).toBe("mock");
    expect(profile).toBeUndefined();
  });

  it("resolveModel keeps its model-only signature on the profiled path", () => {
    nolaRuntime.configure({ model: nola.infer(), telemetry: [] });
    expect(nolaRuntime.current().resolveModel("fast").name).toBe("nola");
  });
});

describe("the profile on the ask path", () => {
  it("withModel('fast') under a platform default reaches the model as request.profile and lands on the receipt", async () => {
    const seen: ProviderRequest[] = [];
    const receipts: AskReceipt[] = [];
    const profilesSeen: (string | undefined)[] = [];
    nolaRuntime.configure({
      model: { default: platform(), probe: probeProvider(seen) },
      forceModel: "probe",
      telemetry: [
        {
          name: "capture",
          onProviderRequest: (e) => profilesSeen.push(e.profile),
          onAskEnd: (e) => receipts.push(e.receipt),
        },
      ],
    });
    const frame = openTestFrame();
    await extract().withModel("fast").run(frame);
    expect(seen[0]?.profile).toBe("fast");
    expect(profilesSeen).toEqual(["fast"]);
    expect(receipts[0]?.profile).toBe("fast");
  });

  it("a plain ask sends no profile", async () => {
    const seen: ProviderRequest[] = [];
    nolaRuntime.configure({ model: { default: platform(), probe: probeProvider(seen) }, forceModel: "probe" });
    await extract().run(openTestFrame());
    expect(seen[0]?.profile).toBeUndefined();
    expect("profile" in (seen[0] as object)).toBe(false);
  });
});
