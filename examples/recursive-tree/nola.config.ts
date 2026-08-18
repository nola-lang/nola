import { mockProvider } from "@nola-lang/providers";
import { defineConfig } from "@nola-lang/runtime";

export default defineConfig({
  providers: {
    default: mockProvider([
      {
        label: "filesystem",
        children: [{ label: "src", children: [{ label: "main.ts" }] }, { label: "docs" }],
      },
    ]),
  },
});
