import { openai } from "@nola-lang/providers";
import { defineConfig } from "@nola-lang/runtime";

export default defineConfig({
  // Reads OPENAI_API_KEY from the environment at the first ask.
  model: openai("gpt-5-mini"),
  // Offline alternative while developing:
  //   import { mockProvider } from "@nola-lang/providers";
  //   model: mockProvider([{ hello: "world" }]),
});
