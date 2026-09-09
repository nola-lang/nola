import { google } from "@nola-lang/providers";
import { defineConfig } from "@nola-lang/runtime";

export default defineConfig({
  // Reads GEMINI_API_KEY from the environment (the project .env) at the first ask.
  model: google("gemini-2.5-flash"),
  // Offline alternative while developing:
  //   import { mockProvider } from "@nola-lang/providers";
  //   model: mockProvider([{ hello: "world" }]),
});
