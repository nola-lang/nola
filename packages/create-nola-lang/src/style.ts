import pc from "picocolors";

/** The four accents the outro uses; injectable so tests can tag instead of colour. */
export interface OutroColors {
  bold: (s: string) => string;
  dim: (s: string) => string;
  green: (s: string) => string;
  cyan: (s: string) => string;
}

const TITLE = /^(Scaffolded|Added Nola:) (.+?)( \(\d+ files\))?\.$/;
const STEP = /^ {2}(.+?)(# .*)?$/;

/**
 * Colours the plain "Scaffolded … / Next steps" outro the flow composes:
 * green verb, bold subject, dim file count, bold header, cyan commands, dim
 * `# hints`. The flow itself stays colour-free (its text is what tests and
 * the non-interactive path see); only the interactive prompter styles it.
 * picocolors honours NO_COLOR / FORCE_COLOR / non-TTY output on its own.
 */
export function styleOutro(message: string, colors: OutroColors = pc): string {
  return message
    .split("\n")
    .map((line) => {
      const title = TITLE.exec(line);
      if (title) {
        const [, verb, subject, count] = title;
        return `${colors.green(verb)} ${colors.bold(subject)}${count ? ` ${colors.dim(count.trimStart())}` : ""}.`;
      }
      if (line === "Next steps:") return colors.bold(line);
      const step = STEP.exec(line);
      if (step) {
        const [, cmd, hint] = step;
        return `  ${colors.cyan(cmd)}${hint ? colors.dim(hint) : ""}`;
      }
      return line;
    })
    .join("\n");
}
