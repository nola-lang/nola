/**
 * Debug-hover expression extraction for `.tsi` (pure text logic — no vscode
 * import, unit-testable). VS Code's built-in fallback keeps dots so `a.b.c`
 * chains evaluate, but nola's contextual-parameter marker `.name` is not
 * property access: the fallback extracted `.address`, evaluate threw a
 * syntax error, and the debug hover silently showed nothing. Registering an
 * EvaluatableExpressionProvider takes over extraction wholesale, so this
 * must also preserve the chain behavior the fallback provided.
 *
 * Given the hovered word's [start, end) offsets in the line, returns the
 * offsets of the expression to evaluate:
 * - `.address` → just `address` (the marker is dropped);
 * - `user.person.name` hovered on `name` → the whole chain up to the word
 *   (`?.` links included), and a chain rooted at a contextual parameter
 *   naturally drops the marker (`.user.name` → `user.name`).
 */
export function evaluatableRange(
  line: string,
  wordStart: number,
  wordEnd: number,
): { start: number; end: number } | undefined {
  if (wordEnd <= wordStart) return undefined;
  const prefix = line.slice(0, wordStart);
  // identifier segments joined by `.` or `?.`, ending right before the word
  const chain = /(?:[A-Za-z_$][\w$]*\??\.)+$/.exec(prefix);
  if (chain) return { start: wordStart - chain[0].length, end: wordEnd };
  return { start: wordStart, end: wordEnd };
}
