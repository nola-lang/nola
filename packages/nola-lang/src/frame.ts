/** Minimal code frame: the offending line plus a caret. line 1-based, column 0-based. */
export function codeFrame(source: string, line: number, column: number): string {
  const lines = source.split(/\r?\n/);
  const text = lines[line - 1] ?? "";
  const gutter = `${line} | `;
  return `${gutter}${text}\n${" ".repeat(gutter.length + column)}^`;
}
