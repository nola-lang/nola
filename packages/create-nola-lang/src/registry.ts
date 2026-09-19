/**
 * The template menu. Static by design: it is versioned in lockstep with the
 * git tag the example fetcher pulls from, so names and labels cannot drift.
 *
 * The first menu leads (in this order) and is organized BY FEATURE:
 * `feature-extraction` (the default) and `function-calling` are each one
 * `.tsi` file with a top-level ask — the two things Nola does —
 * `typescript-interop` is the infer-function shape called from plain
 * TypeScript, `triage-ticket` (a FEATURED example: fetched from examples/
 * like the rest, listed here because it is the one-file shape on a
 * non-chat vendor) and `empty`. The other curated examples follow (behind
 * "More examples…"). extract-person is deliberately absent —
 * typescript-interop IS extract-person plus the replay ledger.
 */
export interface TemplateDef {
  name: string;
  /** one-line menu description */
  label: string;
  source: "builtin" | "example";
  /**
   * An example listed on the FIRST menu, in registry order beside the
   * builtin templates, instead of behind "More examples…". Its files still
   * come from examples/ (`source` is unchanged).
   */
  featured?: true;
  /**
   * The file that IS the program — what `start` runs, launch.json's
   * `program`, what VS Code opens, where the next-steps comment lands.
   * Absent = the plain-TS `src/main.ts` every other template has.
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
  { name: "feature-extraction", label: "extract typed data from context", source: "builtin", entry: "src/main.tsi" },
  {
    name: "function-calling",
    label: "call an async function from a TypeScript file",
    source: "builtin",
    entry: "src/main.tsi",
  },
  {
    name: "typescript-interop",
    label: "an infer function example, imported and awaited from plain TypeScript",
    source: "builtin",
  },
  {
    name: "triage-ticket",
    label: "ticket triage on a non-chat model: literal unions and booleans as typed questions",
    source: "example",
    featured: true,
    entry: "src/main.tsi",
    provider: { label: "typesafe.ai", envVar: "TYPESAFE_API_KEY" },
  },
  { name: "empty", label: "nola.config + tsconfig only, bring your own code", source: "builtin" },
  { name: "file-ticket", label: "call intents: the model fills a function's arguments", source: "example" },
  { name: "extract-resume", label: "nested arrays of objects, JSDoc schema descriptions", source: "example" },
  { name: "extract-invoice", label: "same-file type references, optional fields", source: "example" },
  { name: "classify-message", label: "closed label sets: union alias, string enum, inline union", source: "example" },
  { name: "chain-of-thought", label: "two asks sharing accumulating context", source: "example" },
  { name: "research-notes", label: "TS control flow orchestrating nola functions", source: "example" },
];

/** The first menu's templates: the builtins and the featured example, in registry order. */
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
