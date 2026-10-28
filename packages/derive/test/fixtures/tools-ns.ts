// A module namespace a tool list may spread or offer bare (tool.test.ts).

/** Search the index. */
export function search(q: string): string[] {
  return [q];
}

export function readFile(path: string): string {
  return path;
}

export const limit = 10;

export class Client {}

export { search as find };

export default function main(): void {}
