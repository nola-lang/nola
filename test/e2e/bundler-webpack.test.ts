import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { type CapturedError, capture, ensureBuilt, shell } from "./helpers/ensure-built.js";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const FIXTURE = fileURLToPath(new URL("./fixtures/webpack-app/", import.meta.url));

describe("webpack plugin e2e", () => {
  beforeAll(() => ensureBuilt(ROOT), 600_000);

  it("node-target build runs the ask", { timeout: 240_000 }, async () => {
    await shell("npx webpack --config webpack.config.mjs", { cwd: FIXTURE });
    const out = await capture(process.execPath, [join(FIXTURE, "dist/entry.cjs")]);
    expect(JSON.parse(out.trim())).toEqual({ answer: "hello Ada" });
  });

  it("web-target build fails with NOLA4001", { timeout: 240_000 }, async () => {
    let message = "";
    try {
      await shell("npx webpack --config webpack.config.mjs --target web", { cwd: FIXTURE });
    } catch (err) {
      const e = err as CapturedError;
      message = `${e.message}\n${e.stdout ?? ""}\n${e.stderr ?? ""}`;
    }
    expect(message).toMatch(/NOLA4001/);
  });
});
