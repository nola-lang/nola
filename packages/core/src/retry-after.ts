/**
 * Retry-After is either delta-seconds or an HTTP-date; both become a ms delta.
 * Provider implementations parse it at the throw site into
 * `NolaProviderError.retryAfterMs`, which the withRetry combinator honours.
 */
export function parseRetryAfter(header: string | null): number | undefined {
  if (header === null || header.trim() === "") return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(header);
  return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now());
}
