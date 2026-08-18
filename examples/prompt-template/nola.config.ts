import { mockProvider } from "@nola-lang/providers";
import { defineConfig } from "@nola-lang/runtime";

// The mock inspects the composed prompt: it answers with the ticket id only
// when both templates rendered (the marker's rules and the extractor's type),
// so `nola run` proves the templates reached the provider.
export default defineConfig({
  providers: {
    default: mockProvider((req) => {
      const text = req.messages.map((m) => m.content).join("\n");
      const rulesRendered = text.includes("Rules: answer only from the arguments above");
      const typeRendered = text.includes("ticket id, comply with string");
      return rulesRendered && typeRendered ? "T-4711" : "TEMPLATE-NOT-RENDERED";
    }),
  },
});
