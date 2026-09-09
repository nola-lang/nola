import { formatIngestLine, type NolaIngestEnvelope, type NolaIngestKind } from "@nola-lang/core";
import { describe, expect, it } from "vitest";

/** Wraps each role in a tag so tests can see the palette without ANSI escapes. */
const tag = (name: string) => (s: string) => `<${name}>${s}</${name}>`;
const tagPalette = { dim: tag("dim"), command: tag("command"), path: tag("path"), ok: tag("ok"), warn: tag("warn"), error: tag("error") };

describe("formatIngestLine", () => {
  let seq = 0;
  const env = (kind: NolaIngestKind, event: unknown, project?: string): NolaIngestEnvelope => ({
    v: 1,
    runId: "run-1",
    pid: 7,
    ...(project !== undefined ? { project } : {}),
    seq: seq++,
    at: new Date(2026, 8, 7, 12, 4, 31, 123).getTime(),
    kind,
    event,
  });
  const site = { file: "src/main.tsi", loc: "3:7" };

  it("opens with the local time and the project", () => {
    const line = formatIngestLine(env("askStart", { askId: "a1", site, provider: "mock" }, "shop"));
    expect(line.startsWith("12:04:31.123 shop ")).toBe(true);
    const bare = formatIngestLine(env("askStart", { askId: "a1", site, provider: "mock" }));
    expect(bare.startsWith("12:04:31.123 ask")).toBe(true);
  });

  it("askStart: site, provider and a one-line instruction excerpt", () => {
    const line = formatIngestLine(
      env("askStart", { askId: "a1", site, provider: "mock", instruction: "triage the\n  customer message" }),
    );
    expect(line).toBe("12:04:31.123 ask    src/main.tsi:3:7 via mock — triage the customer message");
    const long = formatIngestLine(env("askStart", { askId: "a1", site, provider: "mock", instruction: "x".repeat(100) }));
    expect(long.endsWith(`${"x".repeat(71)}…`)).toBe(true);
  });

  it("attempt-level events indent under the ask", () => {
    expect(formatIngestLine(env("providerRequest", { askId: "a1", attempt: 1, provider: "mock" }))).toBe(
      "12:04:31.123   req  #1 → mock",
    );
    expect(
      formatIngestLine(env("providerRequest", { askId: "a1", attempt: 1, provider: "nola", profile: "fast" })),
    ).toBe("12:04:31.123   req  #1 → nola (fast)");
    expect(
      formatIngestLine(env("providerResponse", { askId: "a1", attempt: 1, provider: "mock", text: "no", durationMs: 50 })),
    ).toBe("12:04:31.123   res  #1 ← mock 50ms");
    expect(formatIngestLine(env("validationFailed", { askId: "a1", attempt: 1, site, error: "expected string" }))).toBe(
      "12:04:31.123   warn #1 validation failed: expected string",
    );
    expect(formatIngestLine(env("retry", { askId: "a1", attempt: 1, site, reason: "timeout" }))).toBe(
      "12:04:31.123   retry after #1: timeout",
    );
  });

  it("askEnd: ok with servedBy, duration and attempts; fail with the error", () => {
    const ok = env("askEnd", {
      askId: "a1",
      receipt: { site, servedBy: "mock", attempts: 2, durationMs: 120, outcome: { ok: true, value: 1 } },
    });
    expect(formatIngestLine(ok)).toBe("12:04:31.123 ok     src/main.tsi:3:7 via mock 120ms, 2 attempts");
    const one = env("askEnd", {
      askId: "a1",
      receipt: { site, servedBy: "mock", attempts: 1, durationMs: 9, outcome: { ok: true, value: 1 } },
    });
    expect(formatIngestLine(one)).toBe("12:04:31.123 ok     src/main.tsi:3:7 via mock 9ms");
    const failed = env("askEnd", {
      askId: "a1",
      receipt: { site, servedBy: "mock", attempts: 2, durationMs: 120, outcome: { ok: false, error: "NOLA3011: boom" } },
    });
    expect(formatIngestLine(failed)).toBe(
      "12:04:31.123 fail   src/main.tsi:3:7 via mock 120ms, 2 attempts — NOLA3011: boom",
    );
  });

  it("cleared: the store was wiped from the UI", () => {
    expect(formatIngestLine({ kind: "cleared", at: new Date(2026, 8, 7, 12, 4, 31, 123).getTime() })).toBe(
      "12:04:31.123 clear  all traces removed",
    );
  });

  it("invocationStart: the function being called and its file", () => {
    const line = formatIngestLine(
      env("invocationStart", { invocationId: "i", spanPath: ["i"], fn: "triage", file: "src/main.tsi", detached: false }),
    );
    expect(line).toBe("12:04:31.123 infer  triage() src/main.tsi");
  });

  it("invocationEnd: the function and its file", () => {
    const line = formatIngestLine(
      env("invocationEnd", {
        invocationId: "i",
        trace: { kind: "invocation", fn: "triage", file: "src/main.tsi", spans: [] },
      }),
    );
    expect(line).toBe("12:04:31.123 done   triage() src/main.tsi");
  });

  it("colours by role and keeps the text identical without them", () => {
    const e = env("askEnd", {
      askId: "a1",
      receipt: { site, servedBy: "mock", attempts: 1, durationMs: 9, outcome: { ok: false, error: "boom" } },
    });
    const tagged = formatIngestLine(e, tagPalette);
    expect(tagged).toContain("<dim>12:04:31.123</dim>");
    expect(tagged).toContain("<error>fail  </error>");
    expect(tagged).toContain("<path>src/main.tsi:3:7</path>");
    expect(tagged.replace(/<\/?[a-z]+>/g, "")).toBe(formatIngestLine(e));
    expect(
      formatIngestLine(env("validationFailed", { askId: "a1", attempt: 1, site, error: "x" }), tagPalette),
    ).toContain("<warn>warn</warn>");
    expect(formatIngestLine(env("askStart", { askId: "a1", site, provider: "mock" }), tagPalette)).toContain(
      "<command>ask   </command>",
    );
  });

  it("renders through a palette without changing the text", () => {
    const loud = { dim: (s: string) => `<${s}>`, command: (s: string) => s, path: (s: string) => s, ok: (s: string) => s, warn: (s: string) => s, error: (s: string) => s };
    const e = env("askEnd", { askId: "a1", receipt: { site, servedBy: "mock", attempts: 1, durationMs: 9, outcome: { ok: true } } });
    expect(formatIngestLine(e, loud).replace(/[<>]/g, "")).toBe(formatIngestLine(e));
  });
});
