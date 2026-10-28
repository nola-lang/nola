import { mockProvider } from "@nola-lang/providers";
import { defineConfig } from "@nola-lang/runtime";
// the forbidden edge: the config must be evaluable before Nola modules load
import "./src/shapes.tsi";

export default defineConfig({ model: mockProvider([]) });
