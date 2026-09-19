/**
 * The inference-provider menu the wizard shows right after the template
 * (2026-09-08, replacing the yes/no trial question). Static, like the
 * template registry: `nola` is the platform, labelled "nola: dev" so the row
 * reads as a mode of the project rather than a fourth vendor (the free trial, or a key on the
 * account — see `keyPath`), the four vendors write a bring-your-own config,
 * `none` is the offline default (the builtin templates replay their ledgers). typesafe.ai
 * serves literal unions and booleans only; it is listed for every template all
 * the same, and `providerOptions` (flow.ts) brackets that caveat into its hint.
 */
export type ProviderId = "nola" | "openai" | "anthropic" | "google" | "typesafe" | "none";

export interface ProviderDef {
  id: ProviderId;
  /** menu label */
  label: string;
  /** one-line menu description (the nola row's hint is replaced per key path) */
  hint: string;
  /** the env var the vendor factory reads; absent for nola (NOLA_API_KEY is written by the scaffold) and none */
  envVar?: string;
  /** the `model:` expression the config gets */
  model?: string;
}

export const PROVIDERS: readonly ProviderDef[] = [
  { id: "nola", label: "nola: dev", hint: "25 free hosted runs, no API key required, suited for dev experiments", model: '"nola"' },
  { id: "openai", label: "OpenAI", hint: 'openai("gpt-5-mini"), reads OPENAI_API_KEY', envVar: "OPENAI_API_KEY", model: 'openai("gpt-5-mini")' },
  {
    id: "anthropic",
    label: "Anthropic",
    hint: 'anthropic("claude-sonnet-4-5"), reads ANTHROPIC_API_KEY',
    envVar: "ANTHROPIC_API_KEY",
    model: 'anthropic("claude-sonnet-4-5")',
  },
  { id: "google", label: "Gemini", hint: 'google("gemini-2.5-flash"), reads GEMINI_API_KEY', envVar: "GEMINI_API_KEY", model: 'google("gemini-2.5-flash")' },
  { id: "typesafe", label: "typesafe.ai", hint: "typesafe(), reads TYPESAFE_API_KEY", envVar: "TYPESAFE_API_KEY", model: "typesafe()" },
  { id: "none", label: "Skip for now", hint: "the builtin templates run offline from a replay ledger; pick a model in nola.config.ts later" },
];

export function providerById(id: string): ProviderDef | undefined {
  return PROVIDERS.find((p) => p.id === id);
}

export function providerIds(): ProviderId[] {
  return PROVIDERS.map((p) => p.id);
}

export function isProviderId(id: string): id is ProviderId {
  return providerById(id) !== undefined;
}
