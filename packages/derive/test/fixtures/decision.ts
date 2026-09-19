import type { Choice, Prob, Scale } from "@nola-lang/runtime";

export type Dept = Choice<{ billing: "Payments and refunds"; sales: null }>;
export type Bare = Choice<"a" | "b">;
export type Mood = Scale<["Calm", "Frustrated but civil", "Angry"]>;
export type Urgent = Prob<{ true: "Explicit time pressure"; false: "No urgency" }>;
export type Plain = Prob;

export interface Triage {
  /** Which team should handle this? */
  department: Dept;
  /** How frustrated is the customer? */
  frustration: Mood;
  urgent: Urgent;
  plain?: Plain;
  team: "billing" | "sales";
}

// the criteria survive resolution-time transforms
export type Picked = Pick<Triage, "department">;
export type Loose = Partial<Triage>;
type Wrap<T> = { inner: T };
export type Wrapped = Wrap<Mood>;

// NOLA2015 cases
export type OneLabel = Choice<{ only: null }>;
export type NonLiteral = Choice<{ a: string; b: null }>;
export type ShortScale = Scale<["x", "y"]>; // legal: exactly two
export type LongScale = Scale<["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11"]>;
export type HalfProb = Prob<{ true: "yes"; false: "no"; maybe: "?" }>;
export type PrunedBad = { p: Prob<{ true: "yes"; false: "no"; maybe: "?" }> };
export type ProbWithTags = {
  /** @minimum 0.2 */
  p: Prob;
};

// numeric labels (2026-09-19): a number literal union, the described numeric form, and a mixed union (NOLA2015)
export type Numeric = Choice<1 | 2 | 3>;
export type NumericDescribed = Choice<{ 1: "Low"; 2: "High" }>;
export type MixedLabels = Choice<42 | "other">;
export type SameText = Choice<1 | "1">;
