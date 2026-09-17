import { replay } from "@nola-lang/providers";
import { defineConfig } from "@nola-lang/runtime";

export default defineConfig({
  // The starter runs offline: answers replay from the committed ledger
  // (nola.replay.jsonl), so the first `npm start` needs no API key. The
  // ledger is keyed by the exact prompt — once you edit the .tsi or add
  // asks, switch to a real model:
  //   model: "nola",                 // Nola serves inference; `npx nola-lang key` writes NOLA_API_KEY (25 free runs)
  // or bring your own:
  //   import { openai } from "@nola-lang/providers";
  //   model: openai("gpt-5-mini"),   // reads OPENAI_API_KEY
  model: replay("./nola.replay.jsonl"),
});
