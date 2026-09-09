import { defineConfig, nola } from "@nola-lang/runtime";

// Nola serves inference: reads NOLA_API_KEY from .env (your free trial key)
// and picks the model. Out of runs? `npx nola-lang account` opens your Nola
// account, where prepaid balance is added — or bring your own model and keep
// everything else:
//   import { openai } from "@nola-lang/providers";
//   model: openai("gpt-5-mini"),   // reads OPENAI_API_KEY
export default defineConfig({
  model: nola.infer(),
});
