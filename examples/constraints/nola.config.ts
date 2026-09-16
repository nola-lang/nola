import { mockProvider } from "@nola-lang/providers";
import { defineConfig } from "@nola-lang/runtime";

// The first reply violates four constraints (format, minLength/pattern,
// integer/minimum, minItems); validation lists every issue in one correction
// turn and the second reply satisfies the schema.
export default defineConfig({
  model: mockProvider([
    { email: "not-an-email", handle: "A", age: 12.5, tags: [] },
    { email: "ada@example.com", handle: "ada_l", age: 36, tags: ["ts", "nola"] },
  ]),
});
