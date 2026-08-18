import type { NolaCacheStore } from "@nola-lang/core";

/** Default cache store: process-lifetime Map keyed by fingerprint. */
export function memoryCacheStore(): NolaCacheStore {
  const map = new Map<string, unknown>();
  return {
    get: (fingerprint) => map.get(fingerprint),
    set: (fingerprint, value) => {
      map.set(fingerprint, value);
    },
  };
}
