import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const p = (s: string) => fileURLToPath(new URL(s, import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      // Task 4 (vendor spike) may repoint this first entry at lib/index.js (fallback path).
      {
        find: "@nola-lang/babel-parser",
        replacement: p("packages/babel-parser/src/index.ts"),
      },
      {
        find: /^@nola-lang\/([^/]+)$/,
        replacement: `${p("packages")}/$1/src/index.ts`,
      },
      {
        find: /^nola-lang$/,
        replacement: p("packages/nola-lang/src/index.ts"),
      },
      {
        find: /^create-nola-lang$/,
        replacement: p("packages/create-nola-lang/src/index.ts"),
      },
    ],
  },
  test: {
    include: ["packages/*/test/**/*.test.ts", "test/**/*.test.ts"],
    testTimeout: 20_000,
  },
});
