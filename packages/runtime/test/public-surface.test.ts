import { isPlatformModel, NOLA_PROTOCOL } from "@nola-lang/core";
import { mockProvider } from "@nola-lang/providers";
import type { Askable, Intent } from "@nola-lang/runtime";
import * as root from "@nola-lang/runtime";
import { describe, expect, it } from "vitest";

// The runtime index is the app-facing surface: defineConfig lives here (flat,
// no subpaths — spec addendum 2026-08-10), alongside errors, redaction,
// isIntent, and the nola namespace — nola.infer() is the platform model, the
// one model-dialect terminal (config v2 2026-09-08). Every OTHER provider-shaped thing
// deliberately does not: bring-your-own factories, combinators and
// record/replay live in @nola-lang/providers, and re-exporting them here
// would fork the one true import path the config file teaches.
describe("@nola-lang/runtime public surface", () => {
  it("exports the nola namespace (infer, tracer) and terminalTrace; the preset, platformTracer and a top-level tracer are gone", () => {
    expect(typeof root.nola).toBe("object");
    expect(isPlatformModel(root.nola.infer())).toBe(true);
    expect(typeof root.nola.tracer).toBe("function");
    expect(typeof root.terminalTrace).toBe("function");
    for (const gone of ["tracer", "platformTracer", "platformModel", "PLATFORM_TRACER_HOOK", "isPlatformConfig"]) {
      expect((root as Record<string, unknown>)[gone], gone).toBeUndefined();
    }
    // the wire constants ride along, as they did on the old providers surface
    expect(root.NOLA_PROTOCOL).toBe(NOLA_PROTOCOL);
    expect(typeof root.NOLA_VERSION).toBe("string");
    expect(typeof root.LOW_RUNS_NOTICE).toBe("number");
  });

  it("exports defineConfig from the index and it accepts a bare model or a model map", () => {
    expect(typeof root.defineConfig).toBe("function");
    const mock = mockProvider(["x"]);
    expect(root.defineConfig({ model: mock }).model).toBe(mock);
    expect(root.defineConfig({ model: { default: mock } }).model).toEqual({ default: mock });
  });

  it("exports the app-side essentials", () => {
    expect(typeof root.nolaRuntime.configure).toBe("function");
    expect(typeof root.NolaConfigError).toBe("function");
    expect(typeof root.NolaResolutionError).toBe("function");
    expect(typeof root.isIntent).toBe("function");
    expect(typeof root.redactSecrets).toBe("function");
    // types as values (emit 14): the parse error and the issue formatter
    expect(typeof root.NolaValidationError).toBe("function");
    // InferType is a TYPE (the four-member interface a type value is cast to); the carrier class stays internal
    expect("InferType" in root).toBe(false);
    expect(typeof root.formatIssues).toBe("function");
    expect((root as Record<string, unknown>).effectiveLogLevel).toBeUndefined();
    expect((root as Record<string, unknown>).builtinLogger).toBeUndefined();
    expect(typeof root.terminalTrace).toBe("function");
    // prompt templates: the tag lowered templates render through, and the renderer seam
    expect(typeof root.tpl).toBe("function");
    expect(typeof root.buildInferenceModel).toBe("function");
    // the public Intent/Askable types are interfaces, not the class
    const check: Intent<string> | null = null;
    const askable: Askable<string> | null = check;
    expect(askable).toBeNull();
  });

  it("does not export bring-your-own provider tooling — that lives in @nola-lang/providers", () => {
    const surface = root as Record<string, unknown>;
    expect(surface.openai).toBeUndefined();
    expect(surface.mockProvider).toBeUndefined();
    expect(surface.providers).toBeUndefined();
    expect(surface.withRetry).toBeUndefined();
  });
});

describe("provider contract surface", () => {
  it("exports the model-era names and none of the message-era ones", () => {
    // renderClassic stays in core: providers receive the rendering, nobody in a config needs to render.
    expect("renderClassic" in root).toBe(false);
    expect(typeof root.renderTaskFormat).toBe("function");
    expect(typeof root.buildInferenceModel).toBe("function");
    expect(typeof root.describeModel).toBe("function");
    // a hook narrows ProviderRequestEvent.payload with this — hooks must not need @nola-lang/core
    expect(typeof root.isInferenceModel).toBe("function");
    expect(typeof root.redactDeep).toBe("function");
    expect(root.SYSTEM_PREAMBLE).toMatch(/^You are the Nola language runtime/);
    for (const gone of ["PromptBuilder", "fingerprintAsk", "defaultPromptRenderer", "ClassicPromptBuilder", "NolaInferenceBuilder"]) {
      expect((root as Record<string, unknown>)[gone], gone).toBeUndefined();
    }
  });
});

describe("observer type", () => {
  it("exports the NolaTelemetry observer type under that name", () => {
    // a type-level check: assigning an observer literal to the exported type must compile
    const observer: root.NolaTelemetry = { name: "t", onAskEnd: () => {} };
    expect(observer.name).toBe("t");
  });
});
