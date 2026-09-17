import { describe, expect, it } from "vitest";
import { nextCeiling, niceCeiling } from "../src/chart-scale";

describe("niceCeiling", () => {
  it("rounds up to the next 1 / 2 / 5 step", () => {
    expect(niceCeiling(95)).toBe(100);
    expect(niceCeiling(100)).toBe(100);
    expect(niceCeiling(101)).toBe(200);
    expect(niceCeiling(420)).toBe(500);
    expect(niceCeiling(1200)).toBe(2000);
    expect(niceCeiling(5001)).toBe(10_000);
  });

  it("has a floor, so an empty or all-running chart still has an axis", () => {
    expect(niceCeiling(0)).toBe(10);
    expect(niceCeiling(3)).toBe(10);
  });
});

describe("nextCeiling", () => {
  it("starts at the nice ceiling and grows the moment a bar would not fit", () => {
    expect(nextCeiling(undefined, 420)).toBe(500);
    expect(nextCeiling(500, 1200)).toBe(2000);
  });

  it("holds while the tallest bar still uses a fair share of the axis — no twitch on every update", () => {
    expect(nextCeiling(2000, 1900)).toBe(2000);
    expect(nextCeiling(2000, 900)).toBe(2000);
  });

  it("shrinks once the bars have become small against it", () => {
    expect(nextCeiling(2000, 420)).toBe(500);
  });
});
