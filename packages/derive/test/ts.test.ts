import { afterEach, describe, expect, it, vi } from "vitest";

describe("the TypeScript module derive walks with", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("is derive's own dependency when nothing was injected (the loader, the CLI, the bundler plugins)", async () => {
    vi.resetModules();
    const { TS } = await import("../src/ts.js");
    expect(typeof TS.version).toBe("string");
    expect(typeof TS.createLanguageService).toBe("function");
  });

  it("names useTypeScript() when nothing was injected and node:module is unavailable (a browser)", async () => {
    vi.resetModules();
    vi.spyOn(process, "getBuiltinModule").mockReturnValue(undefined as never);
    const { TS } = await import("../src/ts.js");
    expect(() => TS.version).toThrow(/useTypeScript\(\)/);
    // process exists but process.getBuiltinModule does not: the message names Node >= 22.3, not a browser
    expect(() => TS.version).toThrow(/Node >= 22\.3/);
  });
});
