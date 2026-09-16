import { describe, expect, it } from "vitest";
import { inferTypes as t } from "../src/types/infer-type.js";

/**
 * Throughput guard for the carrier validator. Absolute numbers are machine-
 * dependent, so the bound is RELATIVE, measured in the same process against a
 * JSON round-trip of the same value: the validator must not be slower than
 * 1.5× that baseline. The pre-2026-09-15 validator (per-node path spreads,
 * discriminator recomputed per union, Object.entries per object, double Date
 * parse, unconditional output copies) sat at ~2.3× and fails this; the current
 * one sits under 1×. Interleaved best-of-6 on both sides absorbs scheduler noise.
 */
const Address = t.object({ street: t.string(), city: t.string(), zip: t.optional(t.string()) });
const Event = t.union([
  t.object({ kind: t.literal("refund"), amount: t.number(), at: t.date() }),
  t.object({ kind: t.literal("chargeback"), reason: t.string(), disputedAt: t.date() }),
]);
const User = t.object({
  id: t.string(),
  name: t.string(),
  role: t.enum(["admin", "member", "guest"]),
  age: t.number(),
  active: t.boolean(),
  address: t.ref("Address", () => Address),
  tags: t.array(t.string()),
  events: t.array(t.ref("Event", () => Event)),
  since: t.date(),
  nickname: t.optional(t.string()),
  scores: t.record(t.number()),
  note: t.nullable(t.string()),
});
const value = {
  id: "u1",
  name: "Ada",
  role: "admin",
  age: 36,
  active: true,
  address: { street: "1 Main", city: "X", zip: "00000" },
  tags: ["a", "b", "c"],
  events: [
    { kind: "refund", amount: 10, at: "2026-01-01T00:00:00.000Z" },
    { kind: "chargeback", reason: "disputed", disputedAt: "2026-01-02T00:00:00.000Z" },
    { kind: "refund", amount: 20, at: "2026-01-03T00:00:00.000Z" },
  ],
  since: "2026-01-01T00:00:00.000Z",
  scores: { a: 1, b: 2 },
  note: null,
};

/** Interleaved best-of-N for both sides, so worker contention hits them alike and the RATIO stays honest. */
function ratio(a: () => unknown, b: () => unknown, iters: number, rounds: number): number {
  let bestA = Number.POSITIVE_INFINITY;
  let bestB = Number.POSITIVE_INFINITY;
  const time = (fn: () => unknown): number => {
    const t0 = process.hrtime.bigint();
    for (let i = 0; i < iters; i++) fn();
    return Number(process.hrtime.bigint() - t0);
  };
  for (let r = 0; r < rounds; r++) {
    bestA = Math.min(bestA, time(a));
    bestB = Math.min(bestB, time(b));
  }
  return bestA / bestB;
}

describe("validateCarrier throughput", () => {
  it("validates a realistic shape no slower than 1.5× a JSON round-trip of the value", () => {
    for (let i = 0; i < 5_000; i++) {
      User.validate(value);
      JSON.parse(JSON.stringify(value));
    }
    const r = ratio(() => User.validate(value), () => JSON.parse(JSON.stringify(value)), 10_000, 6);
    expect(r).toBeLessThan(1.5);
  });

  it("returns the input reference when nothing in the subtree revives; copies only along revivable paths", () => {
    const plain = t.object({ id: t.string(), tags: t.array(t.string()), meta: t.record(t.number()) });
    const input = { id: "x", tags: ["a"], meta: { n: 1 } };
    const r = plain.validate(input);
    expect(r.ok && r.value).toBe(input);

    const withDate = t.object({ id: t.string(), tags: t.array(t.string()), at: t.date() });
    const dated = { id: "x", tags: ["a"], at: "2026-01-01T00:00:00.000Z" };
    const d = withDate.validate(dated);
    expect(d.ok && d.value).not.toBe(dated);
    expect(d.ok && (d.value as { tags: string[] }).tags).toBe(dated.tags);
    expect(d.ok && (d.value as { at: Date }).at).toBeInstanceOf(Date);
    expect(dated.at).toBe("2026-01-01T00:00:00.000Z");
  });

  it("does not see inherited enumerable properties as unknown", () => {
    const shape = t.object({ id: t.string() });
    const input = Object.assign(Object.create({ inherited: 1 }), { id: "x" });
    expect(shape.validate(input)).toEqual({ ok: true, value: input });
  });
});
