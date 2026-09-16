import { mockProvider } from "@nola-lang/providers";
import { defineConfig } from "@nola-lang/runtime";

// The mock answers the one ask with a chargeback; the date arrives as an ISO
// string on the wire and comes back as a real Date.
export default defineConfig({
  model: mockProvider([{ kind: "chargeback", reason: "disputed charge", disputedAt: "2026-01-03T00:00:00.000Z" }]),
});
