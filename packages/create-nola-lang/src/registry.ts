/**
 * The template menu. Static by design: it is versioned in lockstep with the
 * git tag the example fetcher pulls from, so names and labels cannot drift.
 *
 * `empty` is the ONLY builtin template (config + tsconfig + a stub entry,
 * shipped inside this package). Every other template IS a curated example:
 * its files come from `examples/` — on disk in a dev checkout, from GitHub
 * (the lockstep release tag) in production — and the scaffolder adds the
 * project name, the lockstep ranges, the recommended `.gitignore`, the
 * chosen provider's config and the next-steps comment on top.
 *
 * The first menu leads (in this order) and is organized BY FEATURE:
 * `feature-extraction` (the default) and `function-calling` are each one
 * `.tsi` file with a top-level ask — the two things Nola does —
 * `agent-loop` is the same shape around a top-level `while`,
 * `typescript-interop` is the infer-function shape called from plain
 * TypeScript, `triage-ticket` the one-file shape on a non-chat vendor, then
 * `empty` (a stub `src/main.tsi` to write your own in). The other curated
 * examples follow (behind "More examples…").
 * extract-person is deliberately absent — typescript-interop IS
 * extract-person plus the replay ledger.
 */
export interface TemplateDef {
  name: string;
  /** one-line menu description */
  label: string;
  /** where the files come from: this package's `templates/` dir, or `examples/` */
  source: "builtin" | "example";
  /**
   * An example listed on the FIRST menu, in registry order beside `empty`,
   * instead of behind "More examples…". Its files still come from examples/
   * (`source` is unchanged).
   */
  featured?: true;
  /**
   * The file that IS the program — what `start` runs, launch.json's
   * `program`, what VS Code opens, where the next-steps comment lands.
   * Absent = the plain-TS `src/main.ts` the other examples have.
   */
  entry?: string;
  /**
   * The vendor the template's OWN config names. The flow skips the provider
   * question for such a template (its config is the point of the example),
   * the menu row carries `(<label>)`, and the outro names the env var; an
   * explicit --provider flag still wins.
   */
  provider?: { label: string; envVar: string };
}

/** What a template runs unless it names its own entry: the plain-TS main. */
export const DEFAULT_ENTRY = "src/main.ts";

export const TEMPLATES: readonly TemplateDef[] = [
  {
    name: "feature-extraction",
    label: "extract typed data from context",
    source: "example",
    featured: true,
    entry: "src/main.tsi",
  },
  {
    name: "function-calling",
    label: "call an async function from a TypeScript file",
    source: "example",
    featured: true,
    entry: "src/main.tsi",
  },
  {
    name: "agent-loop",
    label: "an agent loop in one .tsi file: a top-level while with an ask, and a context statement read on every pass",
    source: "example",
    featured: true,
    entry: "src/main.tsi",
  },
  {
    name: "typescript-interop",
    label: "an infer function example, imported and awaited from plain TypeScript",
    source: "example",
    featured: true,
  },
  {
    name: "triage-ticket",
    label: "ticket triage on a non-chat model: literal unions and booleans as typed questions",
    source: "example",
    featured: true,
    entry: "src/main.tsi",
    provider: { label: "typesafe.ai", envVar: "TYPESAFE_API_KEY" },
  },
  { name: "empty", label: "nola.config + tsconfig only, bring your own code", source: "builtin", entry: "src/main.tsi" },
  { name: "file-ticket", label: "call intents: the model fills a function's arguments", source: "example" },
  { name: "extract-resume", label: "nested arrays of objects, JSDoc schema descriptions", source: "example" },
  { name: "extract-invoice", label: "same-file type references, optional fields", source: "example" },
  { name: "classify-message", label: "closed label sets: union alias, string enum, inline union", source: "example" },
  { name: "chain-of-thought", label: "two asks sharing accumulating context", source: "example" },
  { name: "research-notes", label: "TS control flow orchestrating nola functions", source: "example" },
];

/** The first menu's templates: the featured examples and `empty`, in registry order. */
export function featuredNames(): string[] {
  return TEMPLATES.filter((t) => t.source === "builtin" || t.featured).map((t) => t.name);
}

/** The examples behind "More examples…": every example the first menu does not carry. */
export function exampleNames(): string[] {
  return TEMPLATES.filter((t) => t.source === "example" && !t.featured).map((t) => t.name);
}

export function templateByName(name: string): TemplateDef | undefined {
  return TEMPLATES.find((t) => t.name === name);
}

export function templateNames(): string[] {
  return TEMPLATES.map((t) => t.name);
}

/** The template's entry file — what `start` runs, launch.json runs and VS Code opens. */
export function entryFile(template: string | undefined): string {
  return (template === undefined ? undefined : templateByName(template)?.entry) ?? DEFAULT_ENTRY;
}
