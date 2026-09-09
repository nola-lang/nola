// Colour ROLES for CLI output, not colours: every printed accent names what
// it is (a command, a flag, an error) and this one table decides how that
// looks. picocolors decides WHETHER escapes are emitted (NO_COLOR,
// FORCE_COLOR, non-TTY), so a redirected `nola build 2> log` stays clean.
import pc from "picocolors";

/** picocolors' colour set (what `createColors()` returns; the types entry is not re-exported). */
type Colors = Omit<typeof pc, "createColors">;

export interface Palette {
  /** section titles and usage lines */
  heading: (s: string) => string;
  /** a command name */
  command: (s: string) => string;
  /** a `--flag` */
  flag: (s: string) => string;
  /** a file path in a diagnostic */
  path: (s: string) => string;
  /** secondary text: positional placeholders, defaults, positions, gutters */
  dim: (s: string) => string;
  /** a success label */
  ok: (s: string) => string;
  /** a recoverable problem: a validation failure, a retry */
  warn: (s: string) => string;
  /** an error label, code, or caret */
  error: (s: string) => string;
}

/** The terminal palette over a picocolors instance (the default one, or `createColors(true)` in tests). */
export function paletteFrom(colors: Colors): Palette {
  return {
    heading: colors.bold,
    command: colors.cyan,
    flag: colors.cyan,
    path: colors.bold,
    dim: colors.dim,
    ok: colors.green,
    warn: colors.yellow,
    error: colors.red,
  };
}

/** Colours on when the terminal supports them (picocolors' decision). */
export const ansi: Palette = paletteFrom(pc);

const id = (s: string) => s;

/** No colour: what tests and pipes see. */
export const plain: Palette = { heading: id, command: id, flag: id, path: id, dim: id, ok: id, warn: id, error: id };

const tag = (name: keyof Palette) => (s: string) => `<${name}>${s}</${name}>`;

/** Readable `<role>…</role>` tags instead of escapes, for test expectations. */
export const tagPalette: Palette = {
  heading: tag("heading"),
  command: tag("command"),
  flag: tag("flag"),
  path: tag("path"),
  dim: tag("dim"),
  ok: tag("ok"),
  warn: tag("warn"),
  error: tag("error"),
};
