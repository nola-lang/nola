import { mockProvider } from "@nola-lang/providers";
import { builtinLogger, effectiveLogLevel, nolaRuntime } from "@nola-lang/runtime";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openTestFrame } from "./helpers/frame.js";
import { askViaInference } from "./helpers/inference.js";

const ctx = () => openTestFrame();
const ask = () => askViaInference({ frame: ctx(), prompt: "user name", schema: { type: "string" }, loc: "1:1" });

beforeEach(() => {
  delete process.env.NOLA_LOG;
});

afterEach(() => {
  nolaRuntime.reset();
  delete process.env.NOLA_LOG;
  vi.restoreAllMocks();
});

describe("effectiveLogLevel", () => {
  it("defaults to warn", () => {
    expect(effectiveLogLevel()).toBe("warn");
  });

  it("reads the configured level", () => {
    nolaRuntime.configure({ providers: { default: mockProvider(["x"]) }, observability: { logLevel: "info" } });
    expect(effectiveLogLevel()).toBe("info");
  });

  it("NOLA_LOG overrides the configured level", () => {
    nolaRuntime.configure({ providers: { default: mockProvider(["x"]) }, observability: { logLevel: "silent" } });
    process.env.NOLA_LOG = "debug";
    expect(effectiveLogLevel()).toBe("debug");
  });

  it("an invalid NOLA_LOG falls back to the configured level", () => {
    nolaRuntime.configure({ providers: { default: mockProvider(["x"]) }, observability: { logLevel: "info" } });
    process.env.NOLA_LOG = "loud";
    expect(effectiveLogLevel()).toBe("info");
  });
});

describe("builtinLogger", () => {
  it("is registered automatically and logs one info line per ask", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    nolaRuntime.configure({ providers: { default: mockProvider(["Evgen"]) }, observability: { logLevel: "info" } });
    await ask();
    expect(log).toHaveBeenCalledTimes(1);
    const line = String(log.mock.calls[0]?.[0]);
    expect(line).toMatch(/x\.tsi:1:1/);
    expect(line).toMatch(/mock/);
    expect(line).not.toMatch(/user name/); // prompts are debug-only
  });

  it("logs nothing at silent", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    nolaRuntime.configure({ providers: { default: mockProvider(["Evgen"]) }, observability: { logLevel: "silent" } });
    await ask();
    expect(log).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it("logs prompts and raw replies at debug, redacted", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    nolaRuntime.configure({
      providers: { default: { name: "probe", complete: async () => ({ text: '"tok sk-proj-AbCd1234EfGh5678IjKl"' }) } },
      observability: { logLevel: "debug" },
    });
    await ask();
    const all = log.mock.calls.map((c) => String(c[0])).join("\n");
    expect(all).toMatch(/user name/);
    expect(all).not.toMatch(/AbCd1234/);
  });

  it("warns on validation failure at the default level", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    nolaRuntime.configure({ providers: { default: mockProvider([123, "ok"]) } });
    await ask();
    expect(warn).toHaveBeenCalled();
    expect(String(warn.mock.calls[0]?.[0])).toMatch(/x\.tsi:1:1/);
  });

  it("memoizes one logger instance per level", () => {
    nolaRuntime.configure({ providers: { default: mockProvider(["x"]) }, observability: { logLevel: "info" } });
    expect(builtinLogger()).toBe(builtinLogger());
  });
});
