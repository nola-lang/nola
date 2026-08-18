import { openai } from "@nola-lang/providers";
import { defineConfig } from "@nola-lang/runtime";

export default defineConfig({
  providers: {
    // Reads OPENAI_API_KEY from the environment at the first ask.
    default: openai({ model: "gpt-5-mini" }),
    // Offline alternatives while developing:
    //   import { mockProvider } from "@nola-lang/providers";
    //   default: mockProvider([{ hello: "world" }]),
  },
});
