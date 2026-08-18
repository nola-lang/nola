import { replay } from "@nola-lang/providers";
import { defineConfig } from "@nola-lang/runtime";

export default defineConfig({
  providers: {
    // The starter runs offline: answers replay from the committed ledger
    // (nola.replay.jsonl), so the first `npm start` needs no API key. The
    // ledger is keyed by the exact prompt — once you edit the .tsi or add
    // asks, switch to a real provider:
    //   import { openai } from "@nola-lang/providers";
    //   default: openai({ model: "gpt-5-mini" }),   // reads OPENAI_API_KEY
    default: replay("./nola.replay.jsonl"),
  },
});
