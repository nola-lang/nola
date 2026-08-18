import { NOLA_EMIT } from "@nola-lang/core";
import { mockProvider } from "@nola-lang/providers";
import { __nola, NolaVersionError, nolaRuntime } from "@nola-lang/runtime";
import { afterEach, describe, expect, it } from "vitest";
import { claimNolaRuntime } from "../src/runtime/slot.js";

afterEach(() => nolaRuntime.reset());

describe("version guard vocabulary", () => {
  it("NOLA_EMIT is a positive integer", () => {
    expect(Number.isInteger(NOLA_EMIT)).toBe(true);
    expect(NOLA_EMIT).toBeGreaterThan(0);
  });

  it("NolaVersionError carries code and structured details", () => {
    const err = new NolaVersionError("boom", "NOLA3001", {
      expected: 2,
      actual: 1,
      direction: "rebuild",
    });
    expect(err.name).toBe("NolaVersionError");
    expect(err.code).toBe("NOLA3001");
    expect(err.details).toEqual({ expected: 2, actual: 1, direction: "rebuild" });
    expect(err).toBeInstanceOf(Error);
  });
});

describe("__nola.useRuntime", () => {
  it("is a no-op when the emitted contract matches", () => {
    expect(() => __nola.useRuntime(NOLA_EMIT)).not.toThrow();
  });

  it("older build → NOLA3001 telling the user to rebuild", () => {
    let caught: unknown;
    try {
      __nola.useRuntime(NOLA_EMIT - 1);
    } catch (e) {
      caught = e;
    }
    const err = caught as NolaVersionError;
    expect(err).toBeInstanceOf(NolaVersionError);
    expect(err.code).toBe("NOLA3001");
    expect(err.details).toMatchObject({ expected: NOLA_EMIT, actual: NOLA_EMIT - 1, direction: "rebuild" });
    expect(err.message).toContain(`compiled for Nola emit contract ${NOLA_EMIT - 1}`);
    expect(err.message).toContain("`nola build`");
  });

  it("newer build → NOLA3001 telling the user to update the runtime", () => {
    let caught: unknown;
    try {
      __nola.useRuntime(NOLA_EMIT + 1);
    } catch (e) {
      caught = e;
    }
    const err = caught as NolaVersionError;
    expect(err).toBeInstanceOf(NolaVersionError);
    expect(err.code).toBe("NOLA3001");
    expect(err.details).toMatchObject({ direction: "update-runtime" });
    expect(err.message).toContain("npm install nola-lang@latest");
  });
});

describe("duplicate-runtime slot", () => {
  it("a same-emit second copy adopts the first copy's instance (no split-brain)", () => {
    // simulate a second runtime copy loading in the same process
    const copyB = claimNolaRuntime(NOLA_EMIT, "file:///fake/node_modules/nested/runtime/index.js");
    expect(copyB).toBe(nolaRuntime.current());
    // "copy B" configures the (shared) instance
    copyB.configure({ providers: { default: mockProvider(["hi"]) } });
    // this copy's resolveProvider() sees it
    expect(nolaRuntime.current().resolveProvider()).toBe(copyB.config?.providers.default);
  });

  it("nolaRuntime.configure through this copy is visible to an adopted copy", () => {
    const provider = mockProvider(["hi"]);
    nolaRuntime.configure({ providers: { default: provider } });
    const copyB = claimNolaRuntime(NOLA_EMIT, "file:///fake/other/index.js");
    expect(copyB.config?.providers.default).toBe(provider);
  });

  it("a different-emit second copy throws NOLA3002 naming both URLs", () => {
    let caught: unknown;
    try {
      claimNolaRuntime(NOLA_EMIT + 1, "file:///fake/incompatible/index.js");
    } catch (e) {
      caught = e;
    }
    const err = caught as NolaVersionError;
    expect(err).toBeInstanceOf(NolaVersionError);
    expect(err.code).toBe("NOLA3002");
    expect(err.message).toContain("file:///fake/incompatible/index.js");
    expect(err.message).toContain("npm dedupe");
    expect(err.details.urls).toHaveLength(2);
  });

  it("resolveProvider without configuration still throws the config error", () => {
    expect(() => nolaRuntime.current().resolveProvider()).toThrow(/No Nola provider configured/);
  });
});
