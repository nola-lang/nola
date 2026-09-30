import { mockProvider } from "@nola-lang/providers";
import { defineConfig } from "@nola-lang/runtime";

export default defineConfig({
  // Deterministic offline default: the example runs without an API key.
  // Switch to a real provider once you start editing:
  //   import { openai } from "@nola-lang/providers";
  //   model: openai({ model: "gpt-5-mini" }),   // reads OPENAI_API_KEY
  //
  // One reply per pass through the loop; `null` is the answer that ends it.
  model: mockProvider([
    {
      brief: "Nightly export fails",
      description: 'Since yesterday the nightly export job fails with "disk quota exceeded".',
    },
    {
      brief: "Password-reset email not delivered",
      description: "Two users never receive the password-reset email.",
    },
    {
      brief: "Invoice shows the old company name",
      description: "The August invoice still shows the old company name.",
    },
    null,
  ]),
});
