import { mockProvider } from "@nola-lang/providers";
import { defineConfig } from "@nola-lang/runtime";

export default defineConfig({ model: mockProvider([{ name: "Ada", home: { city: "London", zip: "N1" } }]) });
