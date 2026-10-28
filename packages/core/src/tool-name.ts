/**
 * The name a tool is sent under (tool-use spec 2026-10-08 §3.6). A tool list
 * entry is written as the function is reached — `readFile`, `fs.readFile` —
 * and that written text is the tool's name everywhere Nola shows it. The
 * vendors restrict a tool's name to `[A-Za-z0-9_-]`, so the WIRE name
 * replaces every other character with `_`; the compiler refuses a list whose
 * entries collide on it (NOLA2018), which is what makes the mapping back
 * from a model's tool call unambiguous.
 */
export function toolWireName(written: string): string {
  return written.replace(/[^A-Za-z0-9_-]/g, "_");
}
