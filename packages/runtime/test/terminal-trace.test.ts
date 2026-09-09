import { formatIngestLine, type NolaIngestEnvelope } from "@nola-lang/core";
import { mockProvider } from "@nola-lang/providers";
import { NolaConfigError, nolaRuntime, TERMINAL_TRACE, terminalTrace } from "@nola-lang/runtime";
import { afterEach, describe, expect, it, vi } from "vitest";
import { openTestFrame } from "./helpers/frame.js";
import { askViaInference } from "./helpers/inference.js";

const site = { file: "src/main.tsi", loc: "3:7" } as never;
const okReceipt = { site, servedBy: "mock", attempts: 1, durationMs: 9, outcome: { ok: true, value: "x" } } as never;
const failReceipt = { site, servedBy: "mock", attempts: 2, durationMs: 9, outcome: { ok: false, error: "boom" } } as never;

afterEach(() => vi.restoreAllMocks());

/** Captures what the sink writes to stderr, one entry per line. */
function spyStderr(): { lines: string[] } {
  const out = { lines: [] as string[] };
  vi.spyOn(process.stderr, "write").mockImplementation(((chunk: unknown) => {
    out.lines.push(String(chunk).replace(/\n$/, ""));
    return true;
  }) as typeof process.stderr.write);
  return out;
}

describe("terminalTrace", () => {
  it("is a NolaTelemetry named nola:terminal at level debug by default, writing to stderr", () => {
    const err = spyStderr();
    const t = terminalTrace({ color: false });
    expect(t.name).toBe(TERMINAL_TRACE);
    t.onProviderRequest?.({ askId: "a1", attempt: 1, provider: "mock", payload: { messages: [] } } as never);
    expect(err.lines).toHaveLength(1);
    expect(err.lines[0]).toMatch(/req +#1 → mock$/);
  });

  it("colours the line on request and never changes the text", () => {
    const err = spyStderr();
    terminalTrace({ level: "info", color: true }).onAskEnd?.({ askId: "a1", receipt: okReceipt });
    terminalTrace({ level: "info", color: false }).onAskEnd?.({ askId: "a1", receipt: okReceipt });
    const [coloured, plain] = err.lines;
    const ESC = String.fromCharCode(27);
    expect(coloured).toContain(`${ESC}[32mok    ${ESC}[39m`);
    const stripped = coloured
      ?.split(ESC)
      .map((part, i) => (i === 0 ? part : part.replace(/^\[\d+m/, "")))
      .join("");
    // the time column is wall-clock and the two calls may straddle a millisecond; compare everything after it
    const tail = (s: string | undefined) => String(s).slice(String(s).indexOf(" ") + 1);
    expect(tail(stripped)).toBe(tail(plain));
  });

  it("rejects an unknown level", () => {
    expect(() => terminalTrace({ level: "loud" as never })).toThrow(NolaConfigError);
    expect(() => terminalTrace({ level: "loud" as never })).toThrow(
      /terminalTrace\(\): level must be one of silent, error, warn, info, debug/,
    );
  });

  it("prints the line formatIngestLine renders for the same envelope (plain palette)", () => {
    const err = spyStderr();
    terminalTrace({ level: "info", color: false }).onAskEnd?.({ askId: "a1", receipt: okReceipt });
    expect(err.lines).toHaveLength(1);
    const printed = String(err.lines[0]);
    const envelope: NolaIngestEnvelope = {
      v: 1,
      runId: "r",
      pid: process.pid,
      seq: 0,
      at: Date.now(),
      kind: "askEnd",
      event: { askId: "a1", receipt: okReceipt },
    };
    // the time column is wall-clock; compare everything after it
    const tail = (s: string) => s.slice(s.indexOf(" ") + 1);
    expect(tail(printed)).toBe(tail(formatIngestLine(JSON.parse(JSON.stringify(envelope)))));
  });

  it("gates by level: warn prints validation failures and retries, not ask start/end", () => {
    const err = spyStderr();
    const t = terminalTrace({ level: "warn", color: false });
    t.onAskStart?.({ askId: "a1", site, provider: "mock" } as never);
    t.onAskEnd?.({ askId: "a1", receipt: okReceipt });
    t.onValidationFailed?.({ askId: "a1", attempt: 1, site, error: "expected string" } as never);
    t.onRetry?.({ askId: "a1", attempt: 1, site, reason: "timeout" } as never);
    expect(err.lines).toHaveLength(2);
    expect(err.lines[0]).toMatch(/warn +#1 validation failed: expected string$/);
    expect(err.lines[1]).toMatch(/retry after #1: timeout$/);
  });

  it("a failed ask prints at error; silent prints nothing", () => {
    const err = spyStderr();
    terminalTrace({ level: "error", color: false }).onAskEnd?.({ askId: "a1", receipt: failReceipt });
    expect(err.lines).toHaveLength(1);
    expect(err.lines[0]).toMatch(/fail +src\/main\.tsi:3:7 via mock 9ms, 2 attempts — boom$/);
    terminalTrace({ level: "silent", color: false }).onAskEnd?.({ askId: "a1", receipt: failReceipt });
    expect(err.lines).toHaveLength(1);
  });

  it("debug adds the request and reply lines; info adds ask start/end and invocation lines", () => {
    const err = spyStderr();
    const info = terminalTrace({ level: "info", color: false });
    info.onProviderRequest?.({ askId: "a1", attempt: 1, provider: "mock", payload: { messages: [] } } as never);
    info.onInvocationStart?.({
      invocationId: "i1",
      spanPath: ["i1"],
      fn: "go",
      file: "src/main.tsi",
      detached: false,
    } as never);
    expect(err.lines).toHaveLength(1);
    expect(err.lines[0]).toMatch(/infer +go\(\) src\/main\.tsi$/);
    terminalTrace({ level: "debug", color: false }).onProviderRequest?.({
      askId: "a1",
      attempt: 1,
      provider: "mock",
      payload: { messages: [] },
    } as never);
    expect(err.lines[1]).toMatch(/req +#1 → mock$/);
  });
});

describe("terminalTrace wiring", () => {
  afterEach(() => nolaRuntime.reset());

  const ask = () =>
    askViaInference({ frame: openTestFrame(), prompt: "user name", schema: { type: "string" }, loc: "1:1" });

  it("telemetry: { level } is the terminal — the ask line and the ok line per ask at info", async () => {
    const err = spyStderr();
    nolaRuntime.configure({ model: { default: mockProvider(["Evgen"]) }, telemetry: { level: "info" } });
    await ask();
    expect(err.lines.some((l) => /ask +x\.tsi:1:1 via mock/.test(l))).toBe(true);
    expect(err.lines.some((l) => /ok +x\.tsi:1:1 via mock \d+ms$/.test(l))).toBe(true);
  });

  it("telemetry: [] prints nothing", async () => {
    const err = spyStderr();
    nolaRuntime.configure({ model: { default: mockProvider(["Evgen"]) }, telemetry: [] });
    await ask();
    expect(err.lines).toEqual([]);
  });

  it("unconfigured, the terminal sink alone is active at debug — request, reply and validation lines included", async () => {
    const err = spyStderr();
    nolaRuntime.configure({ model: { default: mockProvider([123, "ok"]) } });
    await ask();
    expect(err.lines.some((l) => /req +#1 → mock/.test(l))).toBe(true);
    expect(err.lines.some((l) => /res +#2 ← mock/.test(l))).toBe(true);
    expect(err.lines.some((l) => /validation failed/.test(l))).toBe(true);
  });
});
