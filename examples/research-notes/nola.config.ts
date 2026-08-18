import { mockProvider } from "@nola-lang/providers";
import { defineConfig } from "@nola-lang/runtime";

export default defineConfig({
  providers: {
    // Deterministic offline default: the example runs without an API key.
    // Switch to a real provider once you start editing:
    //   import { openai } from "@nola-lang/providers";
    //   default: openai({ model: "gpt-5-mini" }),   // reads OPENAI_API_KEY
    default: mockProvider([
      "David Gregory inherited castle",
      "Kinnairdy Castle storeys",
      {
        answer: "Kinnairdy Castle, which David Gregory inherited in 1664, has five storeys and a garret.",
        evidence: [
          "David Gregory inherited Kinnairdy Castle in 1664.",
          "Kinnairdy Castle has five storeys and a garret.",
        ],
      },
    ]),
  },
});
