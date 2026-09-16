// THROWAWAY spike fixture — shapes the syntactic walker refuses today.

import type { ParsedPath } from "node:path";
import type { ValidationIssue } from "@nola-lang/core";

export interface Address {
  city: string;
  /** postal code as written */
  zip: string;
}

export interface Person {
  name: string;
  age?: number;
  home: Address;
}

// utility types
export type PartialPerson = Partial<Person>;
export type NameOnly = Pick<Person, "name">;
export type NoHome = Omit<Person, "home">;
export type AllRequired = Required<Person>;

// inheritance + intersection
export interface Employee extends Person {
  role: "admin" | "member";
}
export type Tagged = Person & { tag: string };

// discriminated + nullable + mixed unions
export type Event = { kind: "refund"; amount: number } | { kind: "chargeback"; reason: string };
export type Maybe = { note: string | null; tag?: "a" | "b"; flag: boolean; count: 1 | 2 | 3 };
export type Mixed = string | number;

// tuples, records, index signatures
export type Pair = [string, number];
export type Counts = Record<string, number>;
export interface Dict {
  [key: string]: Address;
}

// generics at the instantiation site
export interface Box<T> {
  value: T;
  items: T[];
}
export type NumBox = Box<number>;

// recursion and Date
export type Tree = { label: string; children?: Tree[] };
export type CalendarEvent = { title: string; at: Date };

// enums
export enum Sentiment {
  Positive = "positive",
  Negative = "negative",
}
export enum Level {
  Low,
  High,
}
export type WithEnum = { sentiment: Sentiment; level: Level };

// package types
export type Issue = ValidationIssue;
export type PathParts = ParsedPath;

// expected unsupported
export type Exotic = { lookup: Map<string, number>; run: () => void; when: Promise<string> };
