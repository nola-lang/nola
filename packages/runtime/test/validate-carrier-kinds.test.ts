import { inferTypes as t } from "@nola-lang/runtime";
import { describe, expect, it } from "vitest";
import { validateCarrier } from "../src/types/validate-carrier.js";

const refund = t.object({ kind: t.literal("refund"), amount: t.number(), at: t.date() });
const chargeback = t.object({ kind: t.literal("chargeback"), reason: t.string() });
const event = t.union([refund, chargeback]);

describe("validateCarrier — emit 15 kinds", () => {
  it("literal and nullable", () => {
    expect(validateCarrier(t.literal(3), 3)).toEqual({ ok: true, value: 3 });
    expect(validateCarrier(t.literal(3), 4)).toEqual({ ok: false, issues: [{ path: [], message: "expected 3, got 4" }] });
    expect(validateCarrier(t.nullable(t.string()), null)).toEqual({ ok: true, value: null });
    expect(validateCarrier(t.nullable(t.string()), 1)).toEqual({
      ok: false,
      issues: [{ path: [], message: "expected string | null, got number" }],
    });
  });

  it("discriminated union: branch by key, precise issues, revival through the branch", () => {
    const ok = validateCarrier(event, { kind: "refund", amount: 1, at: "2026-01-01T00:00:00Z" });
    expect(ok.ok && (ok.value as { at: Date }).at instanceof Date).toBe(true);
    expect(validateCarrier(event, { kind: "refund", amount: "x", at: "2026-01-01T00:00:00Z" })).toEqual({
      ok: false,
      issues: [{ path: ["amount"], message: "expected finite number, got string" }],
    });
    expect(validateCarrier(event, { kind: "other" })).toEqual({
      ok: false,
      issues: [{ path: ["kind"], message: 'expected one of "refund", "chargeback", got "other"' }],
    });
  });

  it("enum-keyed branches discriminate too, and a ref'd member resolves", () => {
    const a = t.ref("A", () => t.object({ tag: t.enum(["a1", "a2"]), n: t.number() }));
    const b = t.object({ tag: t.enum(["b"]), s: t.string() });
    expect(validateCarrier(t.union([a, b]), { tag: "a2", n: "no" })).toEqual({
      ok: false,
      issues: [{ path: ["n"], message: "expected finite number, got string" }],
    });
  });

  it("plain union: first matching member wins, none → one issue naming the alternatives", () => {
    expect(validateCarrier(t.union([t.string(), t.number()]), 1)).toEqual({ ok: true, value: 1 });
    expect(validateCarrier(t.union([t.string(), t.number()]), true)).toEqual({
      ok: false,
      issues: [{ path: [], message: "expected string | number, got boolean" }],
    });
  });

  it("tuple and record", () => {
    expect(validateCarrier(t.tuple([t.string(), t.optional(t.number())]), ["a"])).toEqual({ ok: true, value: ["a"] });
    expect(validateCarrier(t.tuple([t.string(), t.number()]), ["a"])).toEqual({
      ok: false,
      issues: [{ path: [], message: "expected 2 items, got 1" }],
    });
    expect(validateCarrier(t.tuple([t.string(), t.optional(t.number())]), ["a", 1, 2])).toEqual({
      ok: false,
      issues: [{ path: [], message: "expected 1 to 2 items, got 3" }],
    });
    expect(validateCarrier(t.record(t.number()), { a: 1, b: "x" })).toEqual({
      ok: false,
      issues: [{ path: ["b"], message: "expected finite number, got string" }],
    });
    const r = validateCarrier(t.record(t.date()), { a: "2026-01-01T00:00:00Z" });
    expect(r.ok && (r.value as { a: Date }).a instanceof Date).toBe(true);
  });

  it("object with an index signature validates known props and the rest", () => {
    const shape = t.object({ id: t.string() }, { additional: t.number() });
    expect(validateCarrier(shape, { id: "x", a: 1, b: "no" })).toEqual({
      ok: false,
      issues: [{ path: ["b"], message: "expected finite number, got string" }],
    });
  });
});
