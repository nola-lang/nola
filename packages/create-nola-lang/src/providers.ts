/**
 * The inference-provider menu the wizard shows right after the template
 * (2026-09-08, replacing the yes/no trial question). Static, like the
 * template registry: `nola` is the platform (the free trial, or a key on the
 * account — see `keyPath`), the three vendors write a bring-your-own config,
 * `none` is the offline default (the starter replays its ledger).
 */
export type ProviderId = "nola" | "openai" | "anthropic" | "google" | "none";

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
  { id: "nola", label: "Nola", hint: "25 free runs, no account or provider key needed", model: '"nola"' },
  { id: "openai", label: "OpenAI", hint: 'openai("gpt-5-mini"), reads OPENAI_API_KEY', envVar: "OPENAI_API_KEY", model: 'openai("gpt-5-mini")' },
  {
    id: "anthropic",
    label: "Anthropic",
    hint: 'anthropic("claude-sonnet-4-5"), reads ANTHROPIC_API_KEY',
    envVar: "ANTHROPIC_API_KEY",
    model: 'anthropic("claude-sonnet-4-5")',
  },
  { id: "google", label: "Gemini", hint: 'google("gemini-2.5-flash"), reads GEMINI_API_KEY', envVar: "GEMINI_API_KEY", model: 'google("gemini-2.5-flash")' },
  { id: "none", label: "Skip for now", hint: "the starter runs offline from its replay ledger; pick a model in nola.config.ts later" },
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
