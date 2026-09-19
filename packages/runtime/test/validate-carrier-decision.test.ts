import { inferTypes as t } from "@nola-lang/runtime";
import { describe, expect, it } from "vitest";
import { validateCarrier } from "../src/types/validate-carrier.js";

const dept = t.choice({ billing: "Payments", sales: null });
const mood = t.scale(["Calm", "Civil", "Angry"]);
const urgent = t.prob({ true: "yes", false: "no" });

describe("validateCarrier — decision kinds", () => {
  it("choice: label, full distribution summing to 1, optional confidence", () => {
    const ok = { choice: "billing", probabilities: { billing: 0.9, sales: 0.1 }, confidence: 0.9 };
    expect(validateCarrier(dept, ok)).toEqual({ ok: true, value: ok });
    const noConf = { choice: "sales", probabilities: { billing: 0.5, sales: 0.5 } };
    expect(validateCarrier(dept, noConf)).toEqual({ ok: true, value: noConf });
    expect(validateCarrier(dept, { choice: "other", probabilities: { billing: 1, sales: 0 } })).toEqual({
      ok: false,
      issues: [{ path: ["choice"], message: 'expected one of "billing", "sales", got "other"' }],
    });
    expect(validateCarrier(dept, { choice: "billing", probabilities: { billing: 0.9 } })).toEqual({
      ok: false,
      issues: [{ path: ["probabilities", "sales"], message: 'missing probability for label "sales"' }],
    });
    expect(validateCarrier(dept, { choice: "billing", probabilities: { billing: 0.9, sales: 0.3 } })).toEqual({
      ok: false,
      issues: [{ path: ["probabilities"], message: "expected probabilities to sum to 1, got 1.2" }],
    });
    expect(validateCarrier(dept, { choice: "billing", probabilities: { billing: 1, sales: 0 }, confidence: 2 })).toEqual({
      ok: false,
      issues: [{ path: ["confidence"], message: "expected a number between 0 and 1, got 2" }],
    });
    expect(validateCarrier(dept, "billing")).toEqual({
      ok: false,
      issues: [{ path: [], message: "expected a Choice answer object, got string" }],
    });
  });

  it("mixed choice: each label keeps its own kind", () => {
    const mixed = t.choice({ "1": null, a: null }, { numeric: ["1"] });
    const one = { choice: 1, probabilities: { "1": 0.6, a: 0.4 } };
    expect(validateCarrier(mixed, one)).toEqual({ ok: true, value: one });
    const a = { choice: "a", probabilities: { "1": 0.6, a: 0.4 } };
    expect(validateCarrier(mixed, a)).toEqual({ ok: true, value: a });
    expect(validateCarrier(mixed, { choice: "1", probabilities: { "1": 0.6, a: 0.4 } })).toEqual({
      ok: false,
      issues: [{ path: ["choice"], message: 'expected one of 1, "a", got "1"' }],
    });
  });

  it("numeric choice: the label is a number, probabilities keyed by its text", () => {
    const prio = t.choice({ "1": null, "2": null }, { numeric: ["1", "2"] });
    const ok = { choice: 2, probabilities: { "1": 0.3, "2": 0.7 } };
    expect(validateCarrier(prio, ok)).toEqual({ ok: true, value: ok });
    expect(validateCarrier(prio, { choice: "2", probabilities: { "1": 0.3, "2": 0.7 } })).toEqual({
      ok: false,
      issues: [{ path: ["choice"], message: 'expected one of 1, 2, got "2"' }],
    });
    expect(validateCarrier(prio, { choice: 3, probabilities: { "1": 0.3, "2": 0.7 } })).toEqual({
      ok: false,
      issues: [{ path: ["choice"], message: "expected one of 1, 2, got 3" }],
    });
  });

  it("scale: score within [0, n-1], n probabilities summing to 1, levels filled from the type", () => {
    const r = validateCarrier(mood, { score: 1.3, probabilities: [0, 0.7, 0.3], confidence: 0.6 });
    expect(r).toEqual({
      ok: true,
      value: { score: 1.3, probabilities: [0, 0.7, 0.3], confidence: 0.6, levels: ["Calm", "Civil", "Angry"] },
    });
    // a provider that sends levels must send OUR levels
    expect(validateCarrier(mood, { score: 1, probabilities: [0, 1, 0], levels: ["x", "y", "z"] })).toEqual({
      ok: false,
      issues: [{ path: ["levels"], message: 'expected the levels ["Calm", "Civil", "Angry"]' }],
    });
    expect(validateCarrier(mood, { score: 2.5, probabilities: [0, 0, 1] })).toEqual({
      ok: false,
      issues: [{ path: ["score"], message: "expected a number between 0 and 2, got 2.5" }],
    });
    expect(validateCarrier(mood, { score: 1, probabilities: [0.5, 0.5] })).toEqual({
      ok: false,
      issues: [{ path: ["probabilities"], message: "expected 3 probabilities, got 2" }],
    });
  });

  it("scale levels are filled through an enclosing object (the copy path)", () => {
    const triage = t.object({ mood });
    const r = validateCarrier(triage, { mood: { score: 0, probabilities: [1, 0, 0] } });
    expect(r).toEqual({
      ok: true,
      value: { mood: { score: 0, probabilities: [1, 0, 0], levels: ["Calm", "Civil", "Angry"] } },
    });
  });

  it("prob: a number in [0, 1]", () => {
    expect(validateCarrier(urgent, 0.92)).toEqual({ ok: true, value: 0.92 });
    expect(validateCarrier(t.prob(), 0)).toEqual({ ok: true, value: 0 });
    expect(validateCarrier(urgent, 1.5)).toEqual({
      ok: false,
      issues: [{ path: [], message: "expected a number between 0 and 1, got 1.5" }],
    });
    expect(validateCarrier(urgent, true)).toEqual({
      ok: false,
      issues: [{ path: [], message: "expected a probability number, got boolean" }],
    });
  });

  it("collects every issue in one pass", () => {
    const r = validateCarrier(dept, { choice: "other", probabilities: { billing: 0.9, sales: 0.3 }, confidence: -1 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues.map((i) => i.path.join("."))).toEqual(["choice", "probabilities", "confidence"]);
  });
});
