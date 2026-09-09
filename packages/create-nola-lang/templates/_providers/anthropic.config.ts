import { anthropic } from "@nola-lang/providers";
import { defineConfig } from "@nola-lang/runtime";

export default defineConfig({
  // Reads ANTHROPIC_API_KEY from the environment (the project .env) at the first ask.
  model: anthropic("claude-sonnet-4-5"),
  // Offline alternative while developing:
  //   import { mockProvider } from "@nola-lang/providers";
  //   model: mockProvider([{ hello: "world" }]),
});
