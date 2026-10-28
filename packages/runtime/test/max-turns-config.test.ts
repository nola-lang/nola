import { mockProvider } from "@nola-lang/providers";
import { DEFAULT_MAX_TURNS, nolaRuntime, resolveNolaConfig } from "@nola-lang/runtime";
import { afterEach, describe, expect, it } from "vitest";

afterEach(() => nolaRuntime.reset());

// `ask.maxTurns` (spec 2026-10-08 §3.5): the turn cap a tool-use ask runs
// under when its intent sets none; a positive integer, 10 by default.
describe("config ask.maxTurns", () => {
  it("defaults to DEFAULT_MAX_TURNS beside timeoutMs", () => {
    const resolved = resolveNolaConfig({ model: mockProvider([]) });
    expect(DEFAULT_MAX_TURNS).toBe(10);
    expect(resolved.ask).toEqual({ timeoutMs: 60_000, maxTurns: 10 });
    expect(resolveNolaConfig({ model: mockProvider([]), ask: { maxTurns: 3 } }).ask).toEqual({ timeoutMs: 60_000, maxTurns: 3 });
    expect(resolveNolaConfig({ model: mockProvider([]), ask: { timeoutMs: 5 } }).ask).toEqual({ timeoutMs: 5, maxTurns: 10 });
  });

  it.each([0, -1, 1.5, "3", Number.NaN])("rejects %s", (value) => {
    expect(() => resolveNolaConfig({ model: mockProvider([]), ask: { maxTurns: value as number } })).toThrow(/ask\.maxTurns/);
  });

  it("names both keys on an unknown ask key", () => {
    expect(() => resolveNolaConfig({ model: mockProvider([]), ask: { turns: 1 } as never })).toThrow(/timeoutMs, maxTurns/);
  });
});
