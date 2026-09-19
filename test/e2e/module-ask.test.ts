// biome-ignore-all lint/suspicious/noTemplateCurlyInString: the .tsi fixture contains literal ${} interpolation
import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { capture, ensureBuilt } from "./helpers/ensure-built.js";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const CLI = join(ROOT, "packages", "nola-lang", "dist", "main.js");

// Scope-bodies spec §2.1: `ask` directly in the module body. The module is an
// implicit infer function `<module>`; `ask fn()` chains the callee under it.
const MAIN_TSI = [
  "`${.default}\nAnswer with one word.`",
  "infer function label(.mail: string) {",
  "  return ask ..`a one-word label`<string>;",
  "}",
  "type Customer = { id: string; tier: 'free' | 'pro' };",
  "const mail = 'my invoice is wrong';",
  "const .tone = 'brief';",
  "const .customer: Customer = { id: 'c1', tier: 'pro' };",
  "export const kind = ask ..`the kind of request in ${mail}`<string>;",
  "export const tag = ask label(mail);",
  "const g = globalThis as { __fns?: string[]; __prompts?: string[] };",
  "console.log(JSON.stringify({ kind, tag, invocations: g.__fns, prompts: g.__prompts }));",
  "",
].join("\n");

const CONFIG = [
  "const g = globalThis as { __fns?: string[]; __prompts?: string[] };",
  "export default {",
  "  model: {",
  "    default: {",
  "      name: 'canned',",
  "      complete: async (req) => {",
  "        (g.__prompts ??= []).push(req.payload.messages[0].content);",
  "        return { text: JSON.stringify('billing') };",
  "      },",
  "    },",
  "  },",
  "  telemetry: [{ name: 'cap', onInvocationStart: (e) => { (g.__fns ??= []).push(e.fn); } }],",
  "};",
  "",
].join("\n");

describe("module-body ask end-to-end", () => {
  let app: string;

  beforeAll(async () => {
    await ensureBuilt(ROOT);
    app = await mkdtemp(join(tmpdir(), "nola-module-ask-e2e-"));
    mkdirSync(join(app, "src"), { recursive: true });
    writeFileSync(join(app, "package.json"), JSON.stringify({ name: "module-ask-app", type: "module" }));
    writeFileSync(join(app, "nola.config.ts"), CONFIG);
    writeFileSync(join(app, "src", "main.tsi"), MAIN_TSI);
    const scope = join(app, "node_modules", "@nola-lang");
    mkdirSync(scope, { recursive: true });
    symlinkSync(join(ROOT, "packages", "runtime"), join(scope, "runtime"), "junction");
  }, 600_000);

  it("nola run resolves top-level asks; `ask fn()` chains under the <module> root", { timeout: 120_000 }, async () => {
    const out = await capture(process.execPath, [CLI, "run", "src/main.tsi"], { cwd: app });
    const line = out.trim().split("\n").at(-1) ?? "";
    const result = JSON.parse(line) as { kind: string; tag: string; invocations: string[]; prompts: string[] };
    expect(result).toMatchObject({ kind: "billing", tag: "billing", invocations: ["<module>", "<module>", "label"] });
    // the module's contextual bindings reach the model — the annotated one with its derived type
    expect(result.prompts[0]).toContain("CONTEXT — module src/main.tsi");
    expect(result.prompts[0]).toContain('- tone = "brief"');
    // the module's first-statement template wraps its own block
    expect(result.prompts[0]).toContain('{"id":"c1","tier":"pro"}\nAnswer with one word.');
    expect(result.prompts[0]).toContain('- customer (object) = {"id":"c1","tier":"pro"}');
    // and the callee sees them as its caller's context
    expect(result.prompts[1]).toContain("CONTEXT — module src/main.tsi");
    expect(result.prompts[1]).toContain("CONTEXT — inside label(mail), src/main.tsi, called from the context above");
  });

  it("nola check type-checks the lowered top-level await", { timeout: 120_000 }, async () => {
    await expect(capture(process.execPath, [CLI, "check", "."], { cwd: app })).resolves.toBeDefined();
  });
});
