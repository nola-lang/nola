/**
 * Decision types (spec 2026-09-18): the three intrinsic answer types a `.tsi`
 * uses without an import (the compiler appends the type import). Each carries
 * its criteria in an optional phantom member so the derive walk can read them
 * off the RESOLVED type — after Partial / Pick / Omit / generics — by member
 * name (`__nola_*` identifiers are reserved in .tsi, so the name is ours).
 * The members never hold a value.
 */

/** Labels with optional descriptions; `null` means the label speaks for itself. */
export type ChoiceCriteria = Record<string, string | null>;

/** The label union of a criteria map, or the bare union itself (string or number literals). */
export type ChoiceLabel<C> = C extends string | number ? C : keyof C & (string | number);

/**
 * One of a set: the chosen label plus the probability of every label. Labels
 * are string or number literals — a bare union (`"a" | "b"`, `1 | 2`) or the
 * keys of a description map. `probabilities` is keyed by the label's TEXT,
 * as JSON keys are (`probabilities["1"]` for a numeric label).
 */
export type Choice<C extends ChoiceCriteria | string | number> = {
  readonly choice: ChoiceLabel<C>;
  /** every label, sums to 1 */
  readonly probabilities: Readonly<Record<`${ChoiceLabel<C>}`, number>>;
  /** 0–1 from the shape of the distribution; absent when the model reports none */
  readonly confidence?: number;
  readonly __nola_choice?: C;
};

/** Ordered levels, low to high; 2 to 10 of them. */
export type ScaleLevels = readonly [string, string, ...string[]];

/** A position on an ordered scale: the probability-weighted level plus the distribution. */
export type Scale<L extends ScaleLevels> = {
  /** fractional, 0 … levels.length - 1 */
  readonly score: number;
  /** one entry per level, in level order, sums to 1 */
  readonly probabilities: readonly number[];
  /** the levels as written */
  readonly levels: L;
  readonly confidence?: number;
  readonly __nola_scale?: L;
};

export type ProbCriteria = { readonly true: string; readonly false: string };

/** The probability that a statement holds, 0 … 1 (a plain number; the criteria are phantom). */
export type Prob<C extends ProbCriteria = never> = number & { readonly __nola_prob?: C };
