import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import nola from "@nola-lang/webpack";

export default {
  mode: "production",
  target: "node22",
  context: dirname(fileURLToPath(import.meta.url)),
  entry: "./src/entry.ts",
  output: { filename: "entry.cjs", clean: true },
  resolve: {
    extensions: [".ts", ".js"],
    // NodeNext convention: plain TS written for tsc says "./x.js" while only x.ts is on disk.
    extensionAlias: { ".js": [".js", ".ts"] },
  },
  module: {
    rules: [{ test: /\.ts$/, loader: "esbuild-loader", options: { loader: "ts" } }],
  },
  plugins: [nola()],
  devtool: false,
};
