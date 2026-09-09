/** A run of label text, `hit` when it is part of the typed query. */
export interface Segment {
  text: string;
  hit: boolean;
}

/**
 * Split `label` into runs so the query's characters can be highlighted the
 * way VS Code's quick pick does: case-insensitive, in order, spaces in the
 * query ignored. A character that starts a word (or continues the previous
 * hit) wins over an earlier mid-word occurrence, so "fi" over "path of file"
 * lights up "fi" of "file", not the "f" of "of". A query that is not a
 * subsequence of the label yields the label unhit.
 */
export function matchSegments(label: string, query: string): Segment[] {
  const q = query.toLowerCase().replace(/\s+/g, "");
  const hits = q ? search(label.toLowerCase(), q, 0, 0, -1) : undefined;
  if (!hits || hits.length === 0) return [{ text: label, hit: false }];
  const set = new Set(hits);
  const out: Segment[] = [];
  for (let i = 0; i < label.length; i++) {
    const hit = set.has(i);
    const last = out[out.length - 1];
    if (last && last.hit === hit) last.text += label[i];
    else out.push({ text: label[i] ?? "", hit });
  }
  return out;
}

const isWordStart = (s: string, i: number): boolean => i === 0 || !/[\p{L}\p{N}]/u.test(s[i - 1] ?? "");

function search(s: string, q: string, qi: number, from: number, prev: number): number[] | undefined {
  if (qi === q.length) return [];
  const positions: number[] = [];
  for (let i = from; i < s.length; i++) if (s[i] === q[qi]) positions.push(i);
  const preferred = positions.filter((p) => p === prev + 1 || isWordStart(s, p));
  const ordered = [...preferred, ...positions.filter((p) => !preferred.includes(p))];
  for (const p of ordered) {
    const rest = search(s, q, qi + 1, p + 1, p);
    if (rest) return [p, ...rest];
  }
  return undefined;
}
