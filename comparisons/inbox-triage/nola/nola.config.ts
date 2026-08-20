import { mockProvider } from "@nola-lang/providers";
import { defineConfig } from "@nola-lang/runtime";

export default defineConfig({
  providers: {
    // Deterministic offline default: the demo runs without an API key.
    // Switch to a real provider once you start editing:
    //   import { openai } from "@nola-lang/providers";
    //   default: openai({ model: "gpt-5-mini" }),   // reads OPENAI_API_KEY
    default: mockProvider([
      // triageEmail(orderEmail): classification, then the OrderRequest extract
      "order",
      {
        customer: { name: "Dana Reyes", company: "Acme Robotics" },
        shipTo: { street: "500 Harbor Blvd", city: "Oakland", zip: "94607" },
        items: [
          { description: "CX-3 linear actuator", quantity: 12 },
          { description: "mounting kit", quantity: 4 },
        ],
        needBy: "2026-09-30T12:00:00.000Z",
        priority: "rush",
      },
      // triageEmail(quoteEmail): classification, then the combined call-intent slots
      "quote",
      {
        arg0: "quote for ~200 M8 temperature sensor bundles",
        arg1: "Priya Sharma",
      },
    ]),
  },
});
