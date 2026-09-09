import { describe, expect, it } from "vitest";
import { formatClock, formatDuration, statusClass } from "../src/format";

describe("ui format helpers", () => {
  it("formatDuration scales ms → s", () => {
    expect(formatDuration(143)).toBe("143ms");
    expect(formatDuration(2340)).toBe("2.3s");
    expect(formatDuration(undefined)).toBe("—");
    // averages and p95s arrive as raw floats
    expect(formatDuration(204.66666666666666)).toBe("205ms");
    expect(formatDuration(999.6)).toBe("1.0s");
  });

  it("formatClock renders HH:MM:SS local time", () => {
    expect(formatClock(new Date(2026, 7, 31, 9, 5, 7).getTime())).toBe("09:05:07");
  });

  it("statusClass maps status to the dot classes", () => {
    expect(statusClass("running")).toBe("dot dot-live");
    expect(statusClass("ok")).toBe("dot dot-ok");
    expect(statusClass("error")).toBe("dot dot-err");
  });
});
