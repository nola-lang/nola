// Fixture for the tool-contract walk (tool.test.ts): functions a tool list may
// name, in every shape the walk has to answer or refuse, and the groups
// (spec 2026-10-09): a namespace, a tuple, an array, an object of functions.

import * as ns from "./tools-ns.js";

/** Search files under a directory. */
export function search(dir: string, pattern?: string, limit = 10): Promise<string[]> {
  return Promise.resolve([dir, pattern ?? "", String(limit)]);
}

/**
 * Read a file.
 * @param path the absolute path
 */
export function readFile(path: string): string {
  return path;
}

export function withRest(a: string, ...more: number[]): number {
  return a.length + more.length;
}

export function generic<T>(x: T): T {
  return x;
}

export function overloaded(a: string): string;
export function overloaded(a: number): number;
export function overloaded(a: string | number): string | number {
  return a;
}

export const notCallable = 1;

export function withThis(this: { name: string }, a: string): string {
  return this.name + a;
}

export function objectParam(opts: { a: number; b?: string }): void {
  void opts;
}

export function noParams(): number {
  return 1;
}

export function unsupportedParam(m: Map<string, number>): void {
  void m;
}

export const api = { search, nested: { readFile } };

export const unionFn = Math.random() > 0.5 ? search : readFile;
// biome-ignore lint/suspicious/noExplicitAny: the fixture needs an `any`-typed function
export const anyFn: any = search;
export const unknownFn: unknown = search;

export const nsRef = ns;
export const tuple = [search, readFile] as const;
export const list: Array<(path: string) => string> = [readFile];
export const group = { search, readFile, limit: 1, nested: { readFile } };
export const noFunctions = { limit: 1 };
export const badMember = { search, withRest };

export const refs = [
  search,
  readFile,
  api.search,
  api.nested.readFile,
  withRest,
  generic,
  overloaded,
  notCallable,
  withThis,
  objectParam,
  noParams,
  unsupportedParam,
  unionFn,
  anyFn,
  unknownFn,
  nsRef,
  tuple,
  list,
  group,
  noFunctions,
  badMember,
];
