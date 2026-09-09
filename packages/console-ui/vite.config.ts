import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const here = (rel: string): string => fileURLToPath(new URL(rel, import.meta.url));
// Lockstep: this manifest's version IS the console's (and the runtime's) release version.
const { version } = JSON.parse(readFileSync(here("./package.json"), "utf8")) as { version: string };

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: { __NOLA_VERSION__: JSON.stringify(version) },
  resolve: { alias: { "@": here("./src") } },
  build: {
    // The console package serves `dist/ui` beside its compiled module (start.ts);
    // this package is private and exists only to produce that directory.
    outDir: here("../console/dist/ui"),
    emptyOutDir: true,
    // One local-tool bundle; Recharts alone crosses Vite's default 500 kB nudge.
    chunkSizeWarningLimit: 1000,
  },
  server: {
    // `npm run dev -w @nola-lang/console-ui` beside a running `nola console`
    proxy: {
      "/api": "http://localhost:4141",
      "/v1": "http://localhost:4141",
    },
  },
});
