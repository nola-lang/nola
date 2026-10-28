// The library packages as a BROWSER bundle: esbuild for `platform: "browser"` with no aliases and
// no externals (a surviving `node:` import is a resolution error on that platform), evaluated in a
// vm sandbox that has no `process` and no `require` — the webview of a Tauri app, or a Worker on a
// website. The bundle must lower like Node, fingerprint like Node, and run a module-scope ask.
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { compileNola } from "@nola-lang/compiler";
import { fingerprintRequest, type InferenceModel } from "@nola-lang/core";
import { build } from "esbuild";
import { beforeAll, describe, expect, it } from "vitest";
import { finalizeOnNode } from "../../packages/browser/test/helpers/finalize-on-node.js";
import { ensureBuilt } from "./helpers/ensure-built.js";

const root = fileURLToPath(new URL("../..", import.meta.url));
const example = join(root, "examples/feature-extraction/src/main.tsi");

type Entry = typeof import("./fixtures/browser-bundle/entry.js");

let bundle: string;
beforeAll(async () => {
  await ensureBuilt(root);
  const result = await build({
    entryPoints: [join(root, "test/e2e/fixtures/browser-bundle/entry.ts")],
    bundle: true,
    write: false,
    platform: "browser",
    format: "iife",
    globalName: "Nola",
    // `import.meta.url` reaches the runtime's slot claim; an IIFE has none, so give it a name
    define: { "import.meta.url": '"browser-bundle://entry"' },
    logLevel: "silent",
  });
  expect(result.errors).toEqual([]);
  bundle = result.outputFiles[0]?.text ?? "";
}, 300_000);

/** A fresh realm with the web globals the packages use and nothing of Node: no process, no require, no Buffer. */
function sandboxed(): { sandbox: Record<string, unknown>; logs: string[]; Nola: Entry } {
  const logs: string[] = [];
  const sandbox: Record<string, unknown> = {
    console: {
      log: (...args: unknown[]) => logs.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ")),
      info: () => {},
      debug: () => {},
      warn: (...args: unknown[]) => console.warn("[sandbox]", ...args),
      error: (...args: unknown[]) => console.error("[sandbox]", ...args),
    },
    TextEncoder,
    TextDecoder,
    URL,
    setTimeout,
    clearTimeout,
    queueMicrotask,
    crypto: globalThis.crypto,
    performance,
    structuredClone,
    AbortController,
    AbortSignal,
  };
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;
  runInNewContext(bundle, sandbox, { filename: "browser-bundle.js" });
  return { sandbox, logs, Nola: sandbox.Nola as Entry };
}

describe("the library packages as a browser bundle", () => {
  it("contains no node: specifier", () => {
    expect(bundle.length).toBeGreaterThan(100_000);
    expect(bundle).not.toMatch(/require\("node:|from\s*"node:/);
  });

  it("evaluates with no process and no require, lowers like Node and fingerprints like Node", () => {
    const { sandbox, Nola } = sandboxed();
    expect(sandbox.process).toBeUndefined();
    expect(typeof Nola.compileNola).toBe("function");

    const source = readFileSync(example, "utf8");
    const inBrowser = Nola.compileNola(source, "/main.tsi", { sourceRoot: "/" });
    const onNode = compileNola(source, "/main.tsi", { sourceRoot: "/" });
    expect(inBrowser.code).toBe(onNode.code);
    expect(inBrowser.diagnostics).toEqual(onNode.diagnostics);

    const intent: InferenceModel = {
      intent: "extract",
      input: { instruction: "the person described in the text" },
      output: { syntax: "json", schema: { type: "object", properties: { name: { type: "string" } }, required: ["name"] } },
    };
    expect(Nola.fingerprintRequest({ intent })).toBe(fingerprintRequest({ intent }));
    expect(Nola.sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it("runs a module-scope ask through a mock model inside the sandbox", async () => {
    const { sandbox, logs } = sandboxed();
    const file = "/p.tsi";
    const source = "const greeting = ask `say hi`: string;\nconsole.log(greeting);\n";
    const lowered = finalizeOnNode(compileNola(source, file, { sourceRoot: "/" }), file);
    expect(lowered.diagnostics).toEqual([]);
    // Node strips the types (the strip itself is not under test); the runtime import becomes the
    // sandbox's own module — hoisted to the top, as a module loader hoists an import — and the
    // module body runs as an async function so `await` is legal.
    const js = stripTypeScriptTypes(lowered.code, { mode: "strip" }).replace(/import \{ __nola \} from "@nola-lang\/runtime";/, "");
    expect(js).not.toMatch(/@nola-lang\/runtime/);
    const script = `Nola.nolaRuntime.configure({ model: Nola.mockProvider(["hello"]), telemetry: [] });\n(async () => {\nconst { __nola } = Nola;\n${js}\n})()`;
    await runInNewContext(script, sandbox, { filename: "program.js" });
    expect(logs).toEqual(["hello"]);
  });
});
