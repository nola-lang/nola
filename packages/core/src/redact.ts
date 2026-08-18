// Dependency-free leaf module: provider error bodies echo key fingerprints, and the
// runtime re-throws them into user stacks and persists them into receipts.

const PATTERNS: readonly RegExp[] = [
  /\b(?:sk|rk|pk)-[A-Za-z0-9_-]{8,}/g, // OpenAI-family keys
  /\bAIza[0-9A-Za-z_-]{10,}/g, // Google API keys
  /\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, // Authorization values
  /\b[0-9a-f]{32,}\b/gi, // long hex blobs (key fingerprints)
];

/** Replace anything that looks like a credential with `[redacted]`. */
export function redactSecrets(text: string): string {
  let out = text;
  for (const pattern of PATTERNS) {
    out = out.replace(pattern, (match) => {
      const space = match.indexOf(" ");
      // keep the scheme word ("Bearer"/"Basic"), redact only the value
      return space === -1 ? "[redacted]" : `${match.slice(0, space)} [redacted]`;
    });
  }
  return out;
}

/** Render any thrown value as a redacted single-line string. */
export function redactError(error: unknown): string {
  return redactSecrets(error instanceof Error ? error.message : String(error));
}
