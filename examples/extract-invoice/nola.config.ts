import { mockProvider } from "@nola-lang/providers";
import { defineConfig } from "@nola-lang/runtime";

export default defineConfig({
  providers: {
    // Deterministic offline default: the example runs without an API key.
    // Switch to a real provider once you start editing:
    //   import { openai } from "@nola-lang/providers";
    //   default: openai({ model: "gpt-5-mini" }),   // reads OPENAI_API_KEY
    default: mockProvider([
      {
        invoiceNumber: "INV-2042",
        issuedTo: "LoJell Inc",
        lineItems: [
          { description: "widget", quantity: 3, unitPrice: 19.99 },
          { description: "gizmo", quantity: 1, unitPrice: 250 },
        ],
        total: 309.97,
        dueDate: "2026-08-01",
      },
    ]),
  },
});
