// JSDoc constraint tags (spec 2026-09-15) — good shapes and every NOLA2012 class.

export interface Signup {
  /** @format email */
  email: string;
  /**
   * the public handle
   * @minLength 3
   * @maxLength 32
   * @pattern ^[a-z0-9_]+$
   */
  handle: string;
  /** @integer @minimum 13 @maximum 120 */
  age: number;
  /** @minItems 1 @maxItems 10 @uniqueItems */
  tags: string[];
  /** @multipleOf 0.01 @exclusiveMinimum 0 */
  price: number;
  /** @minLength 1 */
  note: string | null;
  /** @minLength 1 */
  nick?: string;
  /** @minLength 2 */
  role: "admin" | "member";
  /** @minItems 2 */
  pair: [string, number];
  /** @see nothing — unrelated tags are ignored */
  plain: string;
}

/** @format uuid */
export type Id = string;

export interface Order {
  /** @minLength 36 */
  id: Id;
  ref: Id;
}

/** @minItems 1 */
export type Tags = string[];

// ---- NOLA2012 ----
export interface BadKind {
  /** @minLength 1 */
  n: number;
}
export interface BadValue {
  /** @minimum ten */
  n: number;
}
export interface BadMissing {
  /** @minimum */
  n: number;
}
export interface BadFormat {
  /** @format e-mail */
  e: string;
}
export interface BadPattern {
  /** @pattern ( */
  s: string;
}
export interface Twice {
  /** @minimum 1 @minimum 2 */
  n: number;
}
export interface OnObject {
  /** @minItems 1 */
  o: { a: string };
}
export interface Mixed {
  /** @minLength 1 */
  m: string | number;
}
export interface OnDate {
  /** @format date */
  d: Date;
}
export interface FlagWithValue {
  /** @integer yes */
  n: number;
}
/** @minimum 1 */
export type BadAlias = { a: string };
