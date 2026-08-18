import { mockProvider, openai } from "@nola-lang/providers";
import { defineConfig } from "@nola-lang/runtime";

export default defineConfig({
  providers: {
    default: process.env.NOLA_E2E_OPENAI ? openai() : mockProvider(["technical"]),
  },
  system: {
    message: "You are triaging support issues for a developer tool.",
  },
});
