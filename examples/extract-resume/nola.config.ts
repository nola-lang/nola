import { mockProvider } from "@nola-lang/providers";
import { defineConfig } from "@nola-lang/runtime";

export default defineConfig({
  providers: {
    // Deterministic offline default: the example runs without an API key.
    // Switch to a real provider once you start editing:
    //   import { openai } from "@nola-lang/providers";
    //   default: openai({ model: "gpt-5-mini" }),   // reads OPENAI_API_KEY
    default: mockProvider([
      {
        name: "Grace Hopper",
        email: "grace@example.com",
        experience: ["United States Navy programmer (1943-1966)", "Eckert-Mauchly, worked on UNIVAC I (1949-1954)"],
        skills: ["COBOL", "compilers"],
        education: [{ school: "Yale University", degree: "PhD in Mathematics", year: 1934 }],
      },
    ]),
  },
});
