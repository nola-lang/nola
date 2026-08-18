import { mockProvider } from "@nola-lang/providers";
import { defineConfig } from "@nola-lang/runtime";

export default defineConfig({
  providers: {
    // Deterministic offline default: the example runs without an API key.
    // Switch to a real provider once you start editing:
    //   import { openai } from "@nola-lang/providers";
    //   default: openai({ model: "gpt-5-mini" }),   // reads OPENAI_API_KEY
    default: mockProvider(["Roger starts with 5 balls. 2 cans of 3 balls each is 6 balls. 5 + 6 = 11.", 11]),
  },
});
