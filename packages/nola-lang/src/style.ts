import type { Palette } from "create-nola-lang";

// `path:line:col CODE: message` (build/check/declarations), or `path CODE: message`
// for the position-less reserved-companion refusal. The path is everything
// before the last `:line:col` — a Windows drive letter carries its own colon.
const HEAD = /^(.+?)(:\d+:\d+)? ((?:NOLA|TS)\d+): /;
const GUTTER = /^(\d+ \|)( .*)?$/;
const CARET = /^( *)\^$/;

/**
 * Colour the plain diagnostic text the commands compose (`printDiagnostics`
 * output and `check`'s tsc lines) at print time, the way `styleOutro` does for
 * the scaffold outro: the text itself stays colour-free — it is what tests
 * and library callers see — and only the bin styles it. Lines that match no
 * diagnostic shape pass through untouched.
 */
export function styleDiagnostics(text: string, p: Palette): string {
  return text
    .split("\n")
    .map((line) => {
      const head = HEAD.exec(line);
      if (head) {
        const [whole, file, pos, code] = head;
        return `${p.path(file as string)}${pos ? p.dim(pos) : ""} ${p.error(code as string)}: ${line.slice(whole.length)}`;
      }
      const gutter = GUTTER.exec(line);
      if (gutter) return `${p.dim(gutter[1] as string)}${gutter[2] ?? ""}`;
      const caret = CARET.exec(line);
      if (caret) return `${caret[1]}${p.error("^")}`;
      return line;
    })
    .join("\n");
}
