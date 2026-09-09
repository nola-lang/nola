import { formatIngestLine } from "@nola-lang/core";
import { ansi, type Palette, plain } from "create-nola-lang";

export { formatIngestLine };

/** True when this Node has unflagged node:sqlite (≥ 22.13). */
export function nodeSupportsConsole(version: string): boolean {
  const [major = 0, minor = 0] = version.split(".").map(Number);
  return major > 22 || (major === 22 && minor >= 13);
}

/**
 * `node:sqlite` announces itself with an ExperimentalWarning the moment it
 * loads — unflagged since 22.13, but still stability 1. The console is the
 * one place we load it on purpose, so that single warning is noise here;
 * every other warning still reaches Node's default printer. Install BEFORE
 * importing `@nola-lang/console` (the import is what triggers it).
 */
export function suppressSqliteExperimentalWarning(): void {
  const emit = process.emitWarning;
  process.emitWarning = ((warning: string | Error, ...rest: unknown[]) => {
    const [typeOrOptions] = rest;
    const type = typeof typeOrOptions === "string" ? typeOrOptions : (typeOrOptions as { type?: string } | undefined)?.type;
    const message = typeof warning === "string" ? warning : warning.message;
    if (type === "ExperimentalWarning" && message.includes("SQLite")) return;
    (emit as (warning: string | Error, ...rest: unknown[]) => void).call(process, warning, ...rest);
  }) as typeof process.emitWarning;
}

/** `home` is the console root (`~/.nola/console`) — the folder, never the database file inside it. */
export function formatConsoleBanner(info: { url: string; home: string }, p: Palette = plain): string {
  return [
    "",
    p.heading("Nola Console started"),
    "",
    `${p.dim("Local:")}    ${p.command(info.url)}`,
    `${p.dim("Home:")}     ${p.path(info.home)}`,
    "",
    p.dim(`Enable tracing with \`telemetry: nola.tracer("${info.url}")\` in nola.config.ts`),
    "",
    p.dim("Press Ctrl+C to stop"),
  ].join("\n");
}

export async function cmdConsole(opts: { port?: number }): Promise<number> {
  if (!nodeSupportsConsole(process.versions.node)) {
    console.error(
      `nola console needs Node >= 22.13 (built-in SQLite) — you are running ${process.versions.node}. Upgrade Node and re-run.`,
    );
    return 1;
  }
  suppressSqliteExperimentalWarning();
  const { startConsole } = await import("@nola-lang/console");
  const running = await startConsole(opts.port !== undefined ? { port: opts.port } : {});
  // The console root is per-machine (~/.nola/console), not per-project — show it absolute.
  console.log(formatConsoleBanner({ url: running.url, home: running.path }, ansi));
  console.log("");
  const unsubscribe = running.onEvent((notice) => console.log(formatIngestLine(notice, ansi)));
  await new Promise<void>((resolve) => {
    const stop = (): void => {
      unsubscribe();
      void running.close().then(resolve, resolve);
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });
  return 0;
}
