/**
 * The template menu. Static by design: it is versioned in lockstep with the
 * git tag the example fetcher pulls from, so names and labels cannot drift.
 * extract-person is deliberately absent — the starter IS extract-person plus
 * the replay ledger.
 */
export interface TemplateDef {
  name: string;
  /** one-line menu description */
  label: string;
  source: "builtin" | "example";
  /**
   * The vendor the template's OWN config names. The flow skips the provider
   * question for such a template (its config is the point of the example),
   * the menu row carries `(<label>)`, and the outro names the env var; an
   * explicit --provider flag still wins.
   */
  provider?: { label: string; envVar: string };
}

export const TEMPLATES: readonly TemplateDef[] = [
  { name: "starter", label: "typed extraction, runs offline out of the box", source: "builtin" },
  { name: "empty", label: "nola.config + tsconfig only, bring your own code", source: "builtin" },
  { name: "file-ticket", label: "call intents: the model fills a function's arguments", source: "example" },
  { name: "extract-resume", label: "nested arrays of objects, JSDoc schema descriptions", source: "example" },
  { name: "extract-invoice", label: "same-file type references, optional fields", source: "example" },
  { name: "classify-message", label: "closed label sets: union alias, string enum, inline union", source: "example" },
  { name: "chain-of-thought", label: "two asks sharing accumulating context", source: "example" },
  { name: "research-notes", label: "TS control flow orchestrating nola functions", source: "example" },
  {
    name: "triage-ticket",
    label: "ticket triage: literal unions and booleans as typed questions",
    source: "example",
    provider: { label: "typesafe.ai", envVar: "TYPESAFE_API_KEY" },
  },
];

export function templateByName(name: string): TemplateDef | undefined {
  return TEMPLATES.find((t) => t.name === name);
}

export function templateNames(): string[] {
  return TEMPLATES.map((t) => t.name);
}
