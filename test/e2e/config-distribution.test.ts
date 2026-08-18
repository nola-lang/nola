import { execFileSync } from "node:child_process";
import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { ensureBuilt } from "./helpers/ensure-built.js";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const CLI = join(ROOT, "packages", "nola-lang", "dist", "main.js");

const GREET_TSI = [
  "export infer function greet(q: string) {",
  "  const v = ask ..`greeting`<string>;",
  "  return v;",
  "}",
  "",
].join("\n");

// The config imports its provider from src/ — the bundled-relative-import
// case — and the built dist must run under PLAIN node: no --import register,
// no nola-lang installed, no manual nolaRuntime.configure().
describe("zero-ceremony production run", () => {
  let app: string;

  beforeAll(async () => {
    await ensureBuilt(ROOT);
    app = await mkdtemp(join(tmpdir(), "nola-prod-e2e-"));
    mkdirSync(join(app, "src"), { recursive: true });
    writeFileSync(join(app, "package.json"), JSON.stringify({ name: "prod-app", type: "module" }));
    writeFileSync(
      join(app, "src", "provider.ts"),
      "export const canned = { name: 'canned', complete: async () => ({ text: JSON.stringify('hello from dist') }) };\n",
    );
    writeFileSync(
      join(app, "nola.config.ts"),
      "import { canned } from './src/provider.ts';\nexport default { providers: { default: canned } };\n",
    );
    writeFileSync(join(app, "src", "greet.tsi"), GREET_TSI);
    writeFileSync(
      join(app, "entry.mjs"),
      "import { greet } from './dist/src/greet.tsi.js';\nconsole.log(JSON.stringify(await greet('hi')));\n",
    );
    const scope = join(app, "node_modules", "@nola-lang");
    mkdirSync(scope, { recursive: true });
    symlinkSync(join(ROOT, "packages", "runtime"), join(scope, "runtime"), "junction");
    execFileSync(process.execPath, [CLI, "build", ".", "--out", "dist"], { cwd: app, encoding: "utf8" });
  }, 600_000);

  it("runs the built output under plain node — config auto-applied before the first ask", () => {
    const out = execFileSync(process.execPath, ["entry.mjs"], { cwd: app, encoding: "utf8" });
    expect(JSON.parse(out.trim())).toBe("hello from dist");
  });
});
