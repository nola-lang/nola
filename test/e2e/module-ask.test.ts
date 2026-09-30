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
//
// Context statements (spec 2026-09-29): A (`Support inbox…`) and B (`Escalations…`)
// are the module's two items. The module block renders ONCE per call chain, with the
// union of the item lists the chain hands it, in the module's own order. What each ask proves:
//   early — a module ask that saw [A] calls `rank`, declared after B: the callee's list adds B
//   kind  — a module ask that saw [A, B], no function: both items, then its bindings
//   tag   — a module ask that saw [A, B] calls `label`, declared before B: the caller's view holds B
//   step  — `await escalate()` is a detached root: no caller view, only its own list, and its own item
const MAIN_TSI = [
  "`Support inbox for ${brand}. Answer with one word.`",
  "const brand = 'Acme';",
  "infer function label(.mail: string) {",
  "  return ask ..`a one-word label`<string>;",
  "}",
  "export const early = ask rank('an early mail');",
  "`Escalations go to the on-call engineer.`",
  "infer function rank(.mail: string) {",
  "  return ask ..`a one-word priority`<string>;",
  "}",
  "type Customer = { id: string; tier: 'free' | 'pro' };",
  "const mail = 'my invoice is wrong';",
  "const .tone = 'brief';",
  "const .customer: Customer = { id: 'c1', tier: 'pro' };",
  "export const kind = ask ..`the kind of request in ${mail}`<string>;",
  "export const tag = ask label(mail);",
  "export const step = await escalate(mail);",
  "infer function escalate(.mail: string) {",
  "  `Steps so far:` [kind, tag];",
  "  return ask ..`the next step`<string>;",
  "}",
  "const g = globalThis as { __fns?: string[]; __prompts?: string[] };",
  "console.log(JSON.stringify({ early, kind, tag, step, invocations: g.__fns, prompts: g.__prompts }));",
  "",
].join("\n");

const CONFIG = [
  'import { renderPrompt } from "@nola-lang/providers";',
  "const g = globalThis as { __fns?: string[]; __prompts?: string[] };",
  "export default {",
  "  model: {",
  "    default: {",
  "      name: 'canned',",
  "      infer: async (req) => {",
  "        (g.__prompts ??= []).push(renderPrompt(req.intent).messages[0].content);",
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
    // the config renders the probe's prompt through @nola-lang/providers, so both workspace packages are linked
    for (const pkg of ["runtime", "providers"]) symlinkSync(join(ROOT, "packages", pkg), join(scope, pkg), "junction");
  }, 600_000);

  it("nola run: the module block renders once with the union of the items, in both directions; a detached root sees its own list", { timeout: 120_000 }, async () => {
    const out = await capture(process.execPath, [CLI, "run", "src/main.tsi"], { cwd: app });
    const line = out.trim().split("\n").at(-1) ?? "";
    const result = JSON.parse(line) as { early: string; kind: string; tag: string; step: string; invocations: string[]; prompts: string[] };
    expect(result).toMatchObject({
      early: "billing",
      kind: "billing",
      tag: "billing",
      step: "billing",
      invocations: ["<module>", "rank", "<module>", "<module>", "label", "escalate"],
    });
    const A = "Support inbox for Acme. Answer with one word.";
    const B = "Escalations go to the on-call engineer.";
    const bindings = ['<input name="tone">', "brief", "</input>", '<input name="customer">', "{", '  "id": "c1",', '  "tier": "pro"', "}", "</input>"];
    expect(result.prompts).toHaveLength(4);
    // once per call chain, in every ask
    for (const prompt of result.prompts) expect(prompt.match(/<context module=/g)).toHaveLength(1);

    // early: a module ask that saw [A] calls `rank`, declared after B — the callee's list adds B.
    // One block, both items in the module's order; the bindings are declared further down, so none yet
    expect(result.prompts[0]).toBe(
      [
        '<context module="src/main.tsi">',
        A,
        B,
        "</context>",
        "",
        '<context function="rank">',
        '<input name="mail">',
        "an early mail",
        "</input>",
        "</context>",
        "",
        "<task>",
        "a one-word priority",
        "</task>",
      ].join("\n"),
    );

    // kind: a module ask that saw [A, B]: both items, then its bindings
    expect(result.prompts[1]).toBe(
      ['<context module="src/main.tsi">', A, B, ...bindings, "</context>", "", "<task>", "the kind of request in my invoice is wrong", "</task>"].join("\n"),
    );

    // tag: a module ask that saw [A, B] calls `label`, declared before B — the caller's view already holds B.
    // Still one block; the chained callee follows it, with its own input
    expect(result.prompts[2]).toBe(
      [
        '<context module="src/main.tsi">',
        A,
        B,
        ...bindings,
        "</context>",
        "",
        '<context function="label">',
        '<input name="mail">',
        "my invoice is wrong",
        "</input>",
        "</context>",
        "",
        "<task>",
        "a one-word label",
        "</task>",
      ].join("\n"),
    );

    // step: `await escalate(mail)` is a detached root — no caller view, so its lexical view is its own list
    // (both items, no bindings); its own item reads live module values (`kind` and `tag` are set by now)
    expect(result.prompts[3]).toBe(
      [
        '<context module="src/main.tsi">',
        A,
        B,
        "</context>",
        "",
        '<context function="escalate">',
        'Steps so far: ["billing","billing"]',
        '<input name="mail">',
        "my invoice is wrong",
        "</input>",
        "</context>",
        "",
        "<task>",
        "the next step",
        "</task>",
      ].join("\n"),
    );
  });

  it("nola check type-checks the lowered top-level await", { timeout: 120_000 }, async () => {
    await expect(capture(process.execPath, [CLI, "check", "."], { cwd: app })).resolves.toBeDefined();
  });
});
