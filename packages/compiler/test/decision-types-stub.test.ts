import { describe, expect, it } from "vitest";
import { typecheckLowered } from "./helpers/typecheck.js";

describe("decision types in the ambient stub", () => {
  it("Choice / Scale / Prob are importable and their answer shapes type-check", () => {
    const src = [
      'import type { Choice, Prob, Scale } from "@nola-lang/runtime";',
      'type Dept = Choice<{ billing: "Payments"; sales: null }>;',
      'type Bare = Choice<"a" | "b">;',
      'type Mood = Scale<["Calm", "Civil", "Angry"]>;',
      'type Urgent = Prob<{ true: "Time pressure"; false: "No urgency" }>;',
      "type Plain = Prob;",
      "declare const d: Dept; declare const b: Bare; declare const m: Mood; declare const u: Urgent; declare const p: Plain;",
      'const label: "billing" | "sales" = d.choice;',
      'const bare: "a" | "b" = b.choice;',
      "const pb: number = d.probabilities.billing;",
      "const conf: number | undefined = d.confidence;",
      "const score: number = m.score;",
      'const level: "Calm" | "Civil" | "Angry" = m.levels[Math.round(m.score) as 0 | 1 | 2];',
      "const probs: readonly number[] = m.probabilities;",
      "const asNumber: number = u * 2 + p;",
      "const plainAssign: Plain = 0.5;",
      "export { label, bare, pb, conf, score, level, probs, asNumber, plainAssign };",
      "",
    ].join("\n");
    expect(typecheckLowered({ "x.ts": src })).toEqual([]);
  });

  it("numeric labels: Choice<1 | 2> and the described numeric form", () => {
    const src = [
      'import type { Choice } from "@nola-lang/runtime";',
      "type Priority = Choice<1 | 2 | 3>;",
      'type Level = Choice<{ 1: "Low"; 2: "High" }>;',
      "declare const p: Priority; declare const l: Level;",
      "const chosen: 1 | 2 | 3 = p.choice;",
      "const described: 1 | 2 = l.choice;",
      'const p1: number = p.probabilities["1"];',
      'const l2: number = l.probabilities["2"];',
      "export { chosen, described, p1, l2 };",
      "",
    ].join("\n");
    expect(typecheckLowered({ "x.ts": src })).toEqual([]);
  });

  it("a wrong label or a wrong level count is a type error", () => {
    const src = [
      'import type { Choice, Scale } from "@nola-lang/runtime";',
      'declare const d: Choice<{ billing: "Payments" ; sales: null }>;',
      'const wrong: "other" = d.choice;',
      'type TooShort = Scale<["only"]>;',
      "export { wrong };",
      "",
    ].join("\n");
    const errors = typecheckLowered({ "x.ts": src });
    expect(errors.some((e) => e.includes("TS2322"))).toBe(true); // "billing" | "sales" is not "other"
    expect(errors.some((e) => e.includes("TS2344"))).toBe(true); // ["only"] does not satisfy ScaleLevels
  });
});
