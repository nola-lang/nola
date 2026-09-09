import { Codes } from "@nola-lang/ast";
import { mockProvider } from "@nola-lang/providers";
import { memoryCacheStore, NolaConfigError, nola, resolveBuildConfig, resolveNolaConfig, TERMINAL_TRACE, terminalTrace } from "@nola-lang/runtime";
import { describe, expect, it } from "vitest";

const provider = () => mockProvider(["x"]);

function captureError(fn: () => unknown): unknown {
  try {
    fn();
  } catch (e) {
    return e;
  }
  throw new Error("expected function to throw");
}

describe("resolveNolaConfig", () => {
  it("resolves a minimal valid config, defaults logLevel, and freezes the result", () => {
    const resolved = resolveNolaConfig({ model: provider() });
    expect(Object.keys(resolved.model)).toEqual(["default"]);
    expect(resolved.telemetry.map((o) => o.name)).toEqual([TERMINAL_TRACE]);
    expect(Object.isFrozen(resolved)).toBe(true);
    expect(Object.isFrozen(resolved.model)).toBe(true);
  });

  it("rejects non-object configs with ConfigInvalid", () => {
    const err = captureError(() => resolveNolaConfig(null)) as NolaConfigError;
    expect(err).toBeInstanceOf(NolaConfigError);
    expect(err.code).toBe(Codes.ConfigInvalid);
    expect(() => resolveNolaConfig("nope")).toThrow(/must be an object/);
  });

  it("accepts a bare model as `model` and normalizes it to { default }", () => {
    const p = provider();
    const resolved = resolveNolaConfig({ model: p });
    expect(resolved.model).toEqual({ default: p });
    expect(Object.isFrozen(resolved.model)).toBe(true);
  });

  it("requires `model` to be a model or a map with a default entry", () => {
    expect(() => resolveNolaConfig({})).toThrow(/`model`/);
    expect(() => resolveNolaConfig({ model: null })).toThrow(/`model`/);
    expect(() => resolveNolaConfig({ model: "openai" })).toThrow(/not a model/);
    expect(() => resolveNolaConfig({ model: {} })).toThrow(/default/);
    expect(() => resolveNolaConfig({ model: { fast: provider() } })).toThrow(/default/);
  });

  it("rejects map entries that are not providers, naming the entry", () => {
    expect(() => resolveNolaConfig({ model: { default: { name: "x" } } })).toThrow(
      /model\.default is not a model/,
    );
  });

  it("rejects forceModel naming an unknown provider, with code and the configured names", () => {
    const err = captureError(() =>
      resolveNolaConfig({ model: provider(), forceModel: "mokc" }),
    ) as NolaConfigError;
    expect(err).toBeInstanceOf(NolaConfigError);
    expect(err.code).toBe(Codes.ConfigUnknownModel);
    expect(err.message).toMatch(/configured: default/);
  });

  it("accepts forceModel naming a configured provider", () => {
    const resolved = resolveNolaConfig({
      model: { default: provider(), mock: provider() },
      forceModel: "mock",
    });
    expect(resolved.forceModel).toBe("mock");
  });

  it("rejects the reserved `plugins` key with ConfigReservedKey", () => {
    const err = captureError(() =>
      resolveNolaConfig({ model: provider(), plugins: [] }),
    ) as NolaConfigError;
    expect(err).toBeInstanceOf(NolaConfigError);
    expect(err.code).toBe(Codes.ConfigReservedKey);
    expect(err.message).toMatch(/reserved for a future Nola version/);
  });

  it("defaults middleware to a frozen empty array and accepts functions", () => {
    const empty = resolveNolaConfig({ model: provider() });
    expect(empty.middleware).toEqual([]);
    expect(Object.isFrozen(empty.middleware)).toBe(true);

    const mw = async (_ctx: unknown, next: (c: unknown) => unknown) => next(_ctx);
    const resolved = resolveNolaConfig({ model: provider(), middleware: [mw] });
    expect(resolved.middleware).toEqual([mw]);
  });

  it("rejects a non-array middleware value and non-function entries", () => {
    expect(() => resolveNolaConfig({ model: provider(), middleware: {} })).toThrow(
      /`middleware` must be an array/,
    );
    expect(() => resolveNolaConfig({ model: provider(), middleware: [1] })).toThrow(
      /middleware\[0\] is not a function/,
    );
  });

  it("defaults telemetry to [terminalTrace()] — the terminal at debug", () => {
    const resolved = resolveNolaConfig({ model: provider() });
    expect(resolved.telemetry.map((o) => o.name)).toEqual([TERMINAL_TRACE]);
    expect(Object.isFrozen(resolved.telemetry)).toBe(true);
  });

  it("{ level } is the terminal alone; {} is the default terminal", () => {
    expect(resolveNolaConfig({ model: provider(), telemetry: { level: "info" } }).telemetry.map((o) => o.name)).toEqual([
      TERMINAL_TRACE,
    ]);
    expect(resolveNolaConfig({ model: provider(), telemetry: {} }).telemetry.map((o) => o.name)).toEqual([TERMINAL_TRACE]);
    expect(() => resolveNolaConfig({ model: provider(), telemetry: { level: "loud" } as never })).toThrow(
      /telemetry\.level must be one of silent, error, warn, info, debug/,
    );
    expect(() => resolveNolaConfig({ model: provider(), telemetry: { verbose: true } as never })).toThrow(
      /telemetry\.verbose is not a terminal option/,
    );
  });

  it("a single observer or an array of observers replaces the terminal — nothing implied", () => {
    const observer = { name: "audit", onAskEnd: () => {} };
    expect(resolveNolaConfig({ model: provider(), telemetry: observer }).telemetry).toEqual([observer]);
    const other = { name: "second", onAskStart: () => {} };
    const resolved = resolveNolaConfig({ model: provider(), telemetry: [observer, other] });
    expect(resolved.telemetry[0]).toBe(observer);
    expect(resolved.telemetry[1]).toBe(other);
    expect(resolved.telemetry.some((o) => o.name === TERMINAL_TRACE)).toBe(false);
    expect(Object.isFrozen(resolved.telemetry)).toBe(true);
  });

  it("telemetry: [] is silent — no terminal sink is added", () => {
    expect(resolveNolaConfig({ model: provider(), telemetry: [] }).telemetry).toEqual([]);
  });

  it("rejects a non-object telemetry and bad entries; the console global is not an observer", () => {
    expect(() => resolveNolaConfig({ model: provider(), telemetry: "info" as never })).toThrow(
      /`telemetry` must be \{ level \} \(the terminal\), an observer, or an array of observers/,
    );
    expect(() => resolveNolaConfig({ model: provider(), telemetry: [null] as never })).toThrow(
      /telemetry\[0\] is not an observer \(need an object with at least one on\* method; the terminal is terminalTrace\(\{ level \}\)\)/,
    );
    expect(() => resolveNolaConfig({ model: provider(), telemetry: [() => {}] as never })).toThrow(
      /telemetry\[0\] is not an observer/,
    );
    expect(() => resolveNolaConfig({ model: provider(), telemetry: [{ name: "empty" }] as never })).toThrow(
      /telemetry\[0\] is not an observer/,
    );
    expect(() => resolveNolaConfig({ model: provider(), telemetry: [console] as never })).toThrow(
      /telemetry\[0\] is not an observer/,
    );
    expect(() => resolveNolaConfig({ model: provider(), telemetry: [{ onAskEnd: 1 }] as never })).toThrow(
      /telemetry\[0\]\.onAskEnd must be a function/,
    );
  });

  it("hooks is gone: the error names telemetry", () => {
    expect(() => resolveNolaConfig({ model: provider(), hooks: [] } as never)).toThrow(
      /unknown config key `hooks` — observers are listed under `telemetry` \(\{ level \} for the terminal, or a tracer \/ an object with on\* methods\)/,
    );
  });

  it("rejects unknown top-level keys, listing the allowed ones", () => {
    expect(() => resolveNolaConfig({ model: provider(), providr: 1 })).toThrow(
      /allowed keys: model, project, forceModel, telemetry, middleware, cache/,
    );
  });

  it("a configured terminal sink rides the list", () => {
    const resolved = resolveNolaConfig({ model: provider(), telemetry: [terminalTrace({ level: "debug" })] });
    expect(resolved.telemetry.map((o) => o.name)).toEqual([TERMINAL_TRACE]);
  });
  it("prefixes every error with the source path when given", () => {
    expect(() => resolveNolaConfig({}, { source: "C:/app/nola.config.ts" })).toThrow(/^C:\/app\/nola\.config\.ts: /);
  });

  it("accepts an already-resolved config unchanged (idempotent re-validation)", () => {
    const once = resolveNolaConfig({ model: provider() });
    const twice = resolveNolaConfig(once);
    expect(Object.keys(twice.model)).toEqual(["default"]);
  });
});

describe("project (reshape addendum 2026-09-01)", () => {
  it("an explicit project wins and survives re-resolution", () => {
    const once = resolveNolaConfig({ model: provider(), project: "my-app" });
    expect(once.project).toBe("my-app");
    expect(resolveNolaConfig(once).project).toBe("my-app");
  });

  it("defaults to the nearest package.json name (the repo root here)", () => {
    expect(resolveNolaConfig({ model: provider() }).project).toBe("nola-monorepo");
  });

  it("rejects a non-string or empty project", () => {
    expect(() => resolveNolaConfig({ model: provider(), project: 7 })).toThrow(/`project` must be a non-empty string/);
    expect(() => resolveNolaConfig({ model: provider(), project: "  " })).toThrow(/non-empty string/);
  });
});

describe("platform-config surface (design 2026-09-03)", () => {
  it("forceModel must name a configured model", () => {
    expect(() => resolveNolaConfig({ model: provider(), forceModel: "x" })).toThrow(/forceModel/);
  });

  it("a string in the model slot is not a model under defineConfig", () => {
    expect(() => resolveNolaConfig({ model: "openai/gpt-5-mini" })).toThrow(/a string is not a model/);
    expect(() => resolveNolaConfig({ model: { default: "openai/gpt-5-mini" } })).toThrow(/a string is not a model/);
  });

  it("the platform model is root-only: never a non-default map entry", () => {
    const platform = nola.infer();
    expect(() => resolveNolaConfig({ model: { default: provider(), fast: platform } })).toThrow(/can only be the root/);
  });

  it("the level lives on terminalTrace, not on the config", () => {
    expect(() => terminalTrace({ level: "loud" as never })).toThrow(/terminalTrace\(\): level must be one of/);
  });
});

describe("cache config", () => {
  const providers = () => ({ default: provider() });

  it("cache: {} resolves to a default in-memory store", () => {
    const resolved = resolveNolaConfig({ model: providers(), cache: {} });
    expect(resolved.cache).toBeDefined();
    expect(typeof resolved.cache?.store.get).toBe("function");
    expect(typeof resolved.cache?.store.set).toBe("function");
  });

  it("a custom store is kept as-is", () => {
    const store = memoryCacheStore();
    const resolved = resolveNolaConfig({ model: providers(), cache: { store } });
    expect(resolved.cache?.store).toBe(store);
  });

  it("no cache key -> resolved.cache is undefined", () => {
    expect(resolveNolaConfig({ model: providers() }).cache).toBeUndefined();
  });

  it("rejects a non-object cache and a store without get/set (NOLA3006)", () => {
    expect(() => resolveNolaConfig({ model: providers(), cache: "yes" })).toThrow(/cache/);
    const err = captureError(() =>
      resolveNolaConfig({ model: providers(), cache: { store: { get: 1 } } }),
    ) as NolaConfigError;
    expect(err).toBeInstanceOf(NolaConfigError);
    expect(err.code).toBe(Codes.CacheStoreInvalid);
  });

  it("an observer with only onInvocationEnd validates", () => {
    expect(() => resolveNolaConfig({ model: providers(), telemetry: [{ onInvocationEnd: () => {} }] })).not.toThrow();
    expect(() => resolveNolaConfig({ model: providers(), telemetry: [{ onInvocationEnd: "nope" }] as never })).toThrow(
      /onInvocationEnd must be a function/,
    );
  });
});

describe("compiler config section", () => {
  const providers = () => ({ default: provider() });

  it("defaults underivableContextType to error", () => {
    const resolved = resolveNolaConfig({ model: providers() });
    expect(resolved.compiler.underivableContextType).toBe("error");
  });

  it("accepts each mode and freezes the section", () => {
    for (const mode of ["error", "prune", "omit"] as const) {
      const resolved = resolveNolaConfig({ model: providers(), compiler: { underivableContextType: mode } });
      expect(resolved.compiler.underivableContextType).toBe(mode);
      expect(Object.isFrozen(resolved.compiler)).toBe(true);
    }
  });

  it("rejects a non-object compiler section, unknown keys, and unknown modes", () => {
    expect(() => resolveNolaConfig({ model: providers(), compiler: "strict" })).toThrow(
      /`compiler` must be an object/,
    );
    expect(() => resolveNolaConfig({ model: providers(), compiler: { underivable: "omit" } })).toThrow(
      /unknown compiler config key/,
    );
    const err = captureError(() =>
      resolveNolaConfig({ model: providers(), compiler: { underivableContextType: "loose" } }),
    ) as NolaConfigError;
    expect(err).toBeInstanceOf(NolaConfigError);
    expect(err.code).toBe(Codes.ConfigInvalid);
    expect(err.message).toMatch(/underivableContextType must be one of error, prune, omit/);
  });
});

describe("build section", () => {
  const providers = () => ({ default: provider() });

  it("defaults to app when absent, and resolveNolaConfig carries it", () => {
    expect(resolveBuildConfig(undefined)).toEqual({ target: "app" });
    const resolved = resolveNolaConfig({ model: providers() });
    expect(resolved.build).toEqual({ target: "app" });
  });

  it("accepts lib through the full config", () => {
    const resolved = resolveNolaConfig({ model: providers(), build: { target: "lib" } });
    expect(resolved.build.target).toBe("lib");
  });

  it("validates section-only without a runtime-valid config around it", () => {
    expect(resolveBuildConfig({ target: "lib" }, "nola.config.ts")).toEqual({ target: "lib" });
  });

  it("rejects an unknown target with ConfigInvalid, naming the source", () => {
    const err = captureError(() => resolveBuildConfig({ target: "exe" }, "nola.config.ts")) as NolaConfigError;
    expect(err).toBeInstanceOf(NolaConfigError);
    expect(err.code).toBe(Codes.ConfigInvalid);
    expect(err.message).toMatch(/build\.target must be one of app, lib/);
    expect(err.message).toMatch(/nola\.config\.ts/);
  });

  it("rejects unknown build keys and non-object sections", () => {
    expect(() => resolveBuildConfig({ mode: "app" })).toThrow(/unknown build config key `mode`/);
    expect(() => resolveBuildConfig("app")).toThrow(/`build` must be an object/);
  });
});

