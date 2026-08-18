import { Codes } from "@nola-lang/ast";
import { mockProvider } from "@nola-lang/providers";
import { memoryCacheStore, NolaConfigError, resolveBuildConfig, resolveNolaConfig } from "@nola-lang/runtime";
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
    const resolved = resolveNolaConfig({ providers: { default: provider() } });
    expect(Object.keys(resolved.providers)).toEqual(["default"]);
    expect(resolved.observability.logLevel).toBe("warn");
    expect(Object.isFrozen(resolved)).toBe(true);
    expect(Object.isFrozen(resolved.providers)).toBe(true);
  });

  it("rejects non-object configs with ConfigInvalid", () => {
    const err = captureError(() => resolveNolaConfig(null)) as NolaConfigError;
    expect(err).toBeInstanceOf(NolaConfigError);
    expect(err.code).toBe(Codes.ConfigInvalid);
    expect(() => resolveNolaConfig("nope")).toThrow(/must be an object/);
  });

  it("rejects the legacy { provider } shape with a migration message", () => {
    expect(() => resolveNolaConfig({ provider: provider() })).toThrow(/providers: \{ default:/);
  });

  it("requires a providers object with a default entry", () => {
    expect(() => resolveNolaConfig({})).toThrow(/`providers`/);
    expect(() => resolveNolaConfig({ providers: {} })).toThrow(/default/);
    expect(() => resolveNolaConfig({ providers: { fast: provider() } })).toThrow(/default/);
  });

  it("rejects entries that are not providers, naming the entry", () => {
    expect(() => resolveNolaConfig({ providers: { default: { name: "x" } } })).toThrow(
      /providers\.default is not a NolaProvider/,
    );
  });

  it("rejects forceProvider naming an unknown provider, with code and the configured names", () => {
    const err = captureError(() =>
      resolveNolaConfig({ providers: { default: provider() }, forceProvider: "mokc" }),
    ) as NolaConfigError;
    expect(err).toBeInstanceOf(NolaConfigError);
    expect(err.code).toBe(Codes.ConfigUnknownProvider);
    expect(err.message).toMatch(/configured: default/);
  });

  it("accepts forceProvider naming a configured provider", () => {
    const resolved = resolveNolaConfig({
      providers: { default: provider(), mock: provider() },
      forceProvider: "mock",
    });
    expect(resolved.forceProvider).toBe("mock");
  });

  it("rejects the reserved `plugins` key with ConfigReservedKey", () => {
    const err = captureError(() =>
      resolveNolaConfig({ providers: { default: provider() }, plugins: [] }),
    ) as NolaConfigError;
    expect(err).toBeInstanceOf(NolaConfigError);
    expect(err.code).toBe(Codes.ConfigReservedKey);
    expect(err.message).toMatch(/reserved for a future Nola version/);
  });

  it("defaults middleware to a frozen empty array and accepts functions", () => {
    const empty = resolveNolaConfig({ providers: { default: provider() } });
    expect(empty.middleware).toEqual([]);
    expect(Object.isFrozen(empty.middleware)).toBe(true);

    const mw = async (_ctx: unknown, next: (c: unknown) => unknown) => next(_ctx);
    const resolved = resolveNolaConfig({ providers: { default: provider() }, middleware: [mw] });
    expect(resolved.middleware).toEqual([mw]);
  });

  it("rejects a non-array middleware value and non-function entries", () => {
    expect(() => resolveNolaConfig({ providers: { default: provider() }, middleware: {} })).toThrow(
      /`middleware` must be an array/,
    );
    expect(() => resolveNolaConfig({ providers: { default: provider() }, middleware: [1] })).toThrow(
      /middleware\[0\] is not a function/,
    );
  });

  it("defaults hooks to a frozen empty array", () => {
    const resolved = resolveNolaConfig({ providers: { default: provider() } });
    expect(resolved.hooks).toEqual([]);
    expect(Object.isFrozen(resolved.hooks)).toBe(true);
  });

  it("accepts and freezes a hooks array", () => {
    const hook = { name: "h", onAskStart: () => {} };
    const resolved = resolveNolaConfig({ providers: { default: provider() }, hooks: [hook] });
    expect(resolved.hooks).toEqual([hook]);
    expect(Object.isFrozen(resolved.hooks)).toBe(true);
  });

  it("rejects a non-array hooks value and non-object entries", () => {
    expect(() => resolveNolaConfig({ providers: { default: provider() }, hooks: {} })).toThrow(
      /`hooks` must be an array/,
    );
    expect(() => resolveNolaConfig({ providers: { default: provider() }, hooks: [null] })).toThrow(
      /hooks\[0\] is not a hook object/,
    );
    expect(() => resolveNolaConfig({ providers: { default: provider() }, hooks: [() => {}] })).toThrow(
      /hooks\[0\] is not a hook object/,
    );
  });

  it("rejects a hook whose handler is not a function", () => {
    expect(() => resolveNolaConfig({ providers: { default: provider() }, hooks: [{ onAskEnd: 1 }] })).toThrow(
      /hooks\[0\]\.onAskEnd must be a function/,
    );
  });

  it("rejects unknown top-level keys, listing the allowed ones", () => {
    expect(() => resolveNolaConfig({ providers: { default: provider() }, providr: 1 })).toThrow(
      /allowed keys: providers, forceProvider, observability, hooks, middleware, cache/,
    );
  });

  it("validates observability.logLevel", () => {
    const resolved = resolveNolaConfig({
      providers: { default: provider() },
      observability: { logLevel: "debug" },
    });
    expect(resolved.observability.logLevel).toBe("debug");
    expect(() =>
      resolveNolaConfig({ providers: { default: provider() }, observability: { logLevel: "loud" } }),
    ).toThrow(/logLevel/);
  });

  it("prefixes every error with the source path when given", () => {
    expect(() => resolveNolaConfig({}, { source: "C:/app/nola.config.ts" })).toThrow(/^C:\/app\/nola\.config\.ts: /);
  });

  it("accepts an already-resolved config unchanged (idempotent re-validation)", () => {
    const once = resolveNolaConfig({ providers: { default: provider() } });
    const twice = resolveNolaConfig(once);
    expect(Object.keys(twice.providers)).toEqual(["default"]);
  });
});

describe("cache config", () => {
  const providers = () => ({ default: provider() });

  it("cache: {} resolves to a default in-memory store", () => {
    const resolved = resolveNolaConfig({ providers: providers(), cache: {} });
    expect(resolved.cache).toBeDefined();
    expect(typeof resolved.cache?.store.get).toBe("function");
    expect(typeof resolved.cache?.store.set).toBe("function");
  });

  it("a custom store is kept as-is", () => {
    const store = memoryCacheStore();
    const resolved = resolveNolaConfig({ providers: providers(), cache: { store } });
    expect(resolved.cache?.store).toBe(store);
  });

  it("no cache key -> resolved.cache is undefined", () => {
    expect(resolveNolaConfig({ providers: providers() }).cache).toBeUndefined();
  });

  it("rejects a non-object cache and a store without get/set (NOLA3006)", () => {
    expect(() => resolveNolaConfig({ providers: providers(), cache: "yes" })).toThrow(/cache/);
    const err = captureError(() =>
      resolveNolaConfig({ providers: providers(), cache: { store: { get: 1 } } }),
    ) as NolaConfigError;
    expect(err).toBeInstanceOf(NolaConfigError);
    expect(err.code).toBe(Codes.CacheStoreInvalid);
  });

  it("hooks with only onInvocationEnd validate (Phase 1 gap)", () => {
    expect(() => resolveNolaConfig({ providers: providers(), hooks: [{ onInvocationEnd: () => {} }] })).not.toThrow();
    expect(() => resolveNolaConfig({ providers: providers(), hooks: [{ onInvocationEnd: "nope" }] })).toThrow(
      /onInvocationEnd must be a function/,
    );
  });
});

describe("compiler config section", () => {
  const providers = () => ({ default: provider() });

  it("defaults underivableContextType to error", () => {
    const resolved = resolveNolaConfig({ providers: providers() });
    expect(resolved.compiler.underivableContextType).toBe("error");
  });

  it("accepts each mode and freezes the section", () => {
    for (const mode of ["error", "prune", "omit"] as const) {
      const resolved = resolveNolaConfig({ providers: providers(), compiler: { underivableContextType: mode } });
      expect(resolved.compiler.underivableContextType).toBe(mode);
      expect(Object.isFrozen(resolved.compiler)).toBe(true);
    }
  });

  it("rejects a non-object compiler section, unknown keys, and unknown modes", () => {
    expect(() => resolveNolaConfig({ providers: providers(), compiler: "strict" })).toThrow(
      /`compiler` must be an object/,
    );
    expect(() => resolveNolaConfig({ providers: providers(), compiler: { underivable: "omit" } })).toThrow(
      /unknown compiler config key/,
    );
    const err = captureError(() =>
      resolveNolaConfig({ providers: providers(), compiler: { underivableContextType: "loose" } }),
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
    const resolved = resolveNolaConfig({ providers: providers() });
    expect(resolved.build).toEqual({ target: "app" });
  });

  it("accepts lib through the full config", () => {
    const resolved = resolveNolaConfig({ providers: providers(), build: { target: "lib" } });
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
