import { mockProvider } from "@nola-lang/providers";
import { defineConfig } from "@nola-lang/runtime";

export default defineConfig({
  // Offline by default: the demo runs without an API key. Once you start editing,
  // switch to `model: "nola"` (`npx nola-lang key` writes NOLA_API_KEY) or bring
  // your own:  import { openai } from "@nola-lang/providers";
  //            model: openai("gpt-5-mini"),   // reads OPENAI_API_KEY
  model: mockProvider([
    // orderEmail: classification, then the OrderRequest extract
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
    // quoteEmail: classification, then the call intent's two argument slots
    "quote",
    {
      arg0: "quote for ~200 M8 temperature sensor bundles",
      arg1: "Priya Sharma",
    },
  ]),
});
