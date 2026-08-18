import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { capture, ensureBuilt } from "./helpers/ensure-built.js";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const CLI = join(ROOT, "packages", "nola-lang", "dist", "main.js");

const ORDER_TSI = [
  "function putOrder(order: string, address: string) {",
  '  return order + " -> " + address;',
  "}",
  "export infer function place(request: string) {",
  "  const r = ask putOrder(..`the ordered item`<string>, ..`the delivery address`<string>);",
  "  return r;",
  "}",
  "",
].join("\n");

// Decision 5 of the 2026-08-14 sigil-less call-intent spec: every slot of one
// call intent resolves in ONE combined provider call — never sequentially.
describe("sigil-less call intent resolves all slots in one provider call", () => {
  let app: string;

  beforeAll(async () => {
    await ensureBuilt(ROOT);
    app = await mkdtemp(join(tmpdir(), "nola-sigil-less-e2e-"));
    mkdirSync(join(app, "src"), { recursive: true });
    writeFileSync(join(app, "package.json"), JSON.stringify({ name: "sigil-less-app", type: "module" }));
    writeFileSync(
      join(app, "nola.config.ts"),
      [
        "const g = globalThis as { __calls?: number };",
        "export default {",
        "  providers: {",
        "    default: {",
        "      name: 'counting',",
        "      complete: async () => {",
        "        g.__calls = (g.__calls ?? 0) + 1;",
        "        return { text: JSON.stringify({ arg0: 'pizza', arg1: 'Kyiv' }) };",
        "      },",
        "    },",
        "  },",
        "};",
        "",
      ].join("\n"),
    );
    writeFileSync(join(app, "src", "order.tsi"), ORDER_TSI);
    writeFileSync(
      join(app, "entry.mjs"),
      [
        "import { place } from './dist/src/order.tsi.js';",
        "const r = await place('I want a pizza delivered to Kyiv');",
        "console.log(JSON.stringify({ r, calls: globalThis.__calls }));",
        "",
      ].join("\n"),
    );
    const scope = join(app, "node_modules", "@nola-lang");
    mkdirSync(scope, { recursive: true });
    symlinkSync(join(ROOT, "packages", "runtime"), join(scope, "runtime"), "junction");
    await capture(process.execPath, [CLI, "build", ".", "--out", "dist"], { cwd: app });
  }, 600_000);

  it("fills both extractor slots with exactly ONE provider call", async () => {
    const out = await capture(process.execPath, ["entry.mjs"], { cwd: app });
    expect(JSON.parse(out.trim())).toEqual({ r: "pizza -> Kyiv", calls: 1 });
  });
});
