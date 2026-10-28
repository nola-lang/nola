import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { nola } from "../src/index.js";
import { resetProjects, setConfigEvaluator } from "../src/project.js";
import { setResolver } from "../src/resolve.js";
import { VIEW_NAMESPACE } from "../src/views.js";
import { WIRING_NAMESPACE, wiringIdFor } from "../src/wiring.js";

const TSI = "infer function greet(.name: string) {\n  return ask `say hello`: string;\n}\n";

type LoadResult = { contents: string; loader: string } | undefined;
interface Hook<A, R> {
  filter: RegExp;
  namespace?: string;
  cb: (args: A) => R | Promise<R>;
}

/**
 * Records the hooks `setup` registers and replays them the way Bun does: the first hook whose
 * filter matches and whose namespace constraint admits the module. The two hosts hand the
 * callbacks DIFFERENT argument shapes (probed on Bun 1.3.14; bun-types describe only the
 * bundler's): the RUNTIME (`Bun.plugin`) passes `{ path, importer }` with a namespaced importer
 * spelled `"<namespace>:<path>"` and `{ path, loader }` to onLoad; the BUNDLER (`Bun.build`)
 * passes `{ path, importer, namespace, kind, resolveDir }` and `{ path, namespace, loader }`.
 */
function fakeBuilder(config?: { target?: string }) {
  const bundle = config !== undefined;
  const resolvers: Hook<Record<string, unknown>, unknown>[] = [];
  const loaders: Hook<Record<string, unknown>, LoadResult>[] = [];
  const build = {
    config,
    onResolve(c: { filter: RegExp; namespace?: string }, cb: Hook<Record<string, unknown>, unknown>["cb"]) {
      resolvers.push({ ...c, cb });
      return build;
    },
    onLoad(c: { filter: RegExp; namespace?: string }, cb: Hook<Record<string, unknown>, LoadResult>["cb"]) {
      loaders.push({ ...c, cb });
      return build;
    },
    onStart: () => build,
    onBeforeParse: () => build,
    module: () => build,
  };
  const resolve = (path: string, importerPath = "", importerNamespace = "file") => {
    const hook = resolvers.find((r) => r.filter.test(path) && (r.namespace ?? importerNamespace) === importerNamespace);
    const args = bundle
      ? { path, importer: importerPath, namespace: importerNamespace, kind: "import-statement", resolveDir: dirname(importerPath) }
      : { path, importer: importerNamespace === "file" ? importerPath : `${importerNamespace}:${importerPath}` };
    return hook?.cb(args);
  };
  const load = (path: string, namespace = "file") => {
    const hook = loaders.find((l) => l.filter.test(path) && (l.namespace ?? "file") === namespace);
    return hook?.cb(bundle ? { path, namespace, loader: "ts" } : { path, loader: "ts" });
  };
  return { build, resolve, load };
}

function tmpProject(config = "export default { model: {} };\n"): string {
  const dir = mkdtempSync(join(tmpdir(), "nola-bun-plugin-"));
  writeFileSync(join(dir, "nola.config.ts"), config);
  writeFileSync(join(dir, "greet.tsi"), TSI);
  return dir;
}

function setup(config?: { target?: string }, options?: Parameters<typeof nola>[0]) {
  const fake = fakeBuilder(config);
  nola(options).setup(fake.build as never);
  return fake;
}

afterEach(() => {
  resetProjects();
  setConfigEvaluator(undefined);
  setResolver(undefined);
});

describe("nola() — runtime mode (Bun.plugin: no build config)", () => {
  it("lowers a .tsi to TypeScript with loader ts and no wiring import", async () => {
    const dir = tmpProject();
    setConfigEvaluator(async () => ({ model: {} }));
    const { load } = setup();
    const out = await load(join(dir, "greet.tsi"));
    expect(out?.loader).toBe("ts");
    expect(out?.contents).toContain("__nola.intents.ExtractIntent");
    expect(out?.contents).toContain("__nola.useRuntime(");
    expect(out?.contents).not.toContain("virtual-nola-config");
  });

  it("lets Bun resolve an existing .tsi, serves the view of a missing one, refuses a config-graph .tsi", async () => {
    const dir = tmpProject();
    setConfigEvaluator(async () => ({ model: {} }));
    writeFileSync(join(dir, "shapes.tsi"), "export type S = { k: string };\n");
    writeFileSync(join(dir, "models.ts"), "export interface Person { name: string }\n");
    const { resolve, load } = setup();
    expect(resolve("./shapes.tsi", join(dir, "greet.tsi"))).toBeUndefined();
    expect(resolve("./models.tsi", join(dir, "greet.tsi"))).toEqual({ path: join(dir, "models.ts"), namespace: VIEW_NAMESPACE });
    const view = await load(join(dir, "models.ts"), VIEW_NAMESPACE);
    expect(view?.loader).toBe("ts");
    expect(view?.contents).toContain(`export * from "${join(dir, "models.ts").replaceAll("\\", "/")}"`);
    expect(() => resolve("./shapes.tsi", join(dir, "nola.config.ts"))).toThrow(/NOLA3012/);
    expect(() => resolve("./nope.tsi", join(dir, "greet.tsi"))).toThrow(/NOLA2007/);
  });

  it("a view importing a view: the runtime hands the importer as `nola-view:<path>`, which resolves like the file", async () => {
    const dir = tmpProject();
    setConfigEvaluator(async () => ({ model: {} }));
    writeFileSync(join(dir, "address.ts"), "export interface Address { city: string }\n");
    writeFileSync(join(dir, "models.ts"), 'import type { Address } from "./address.js";\nexport interface Person { name: string; home: Address }\n');
    const { resolve, load } = setup();
    // the view of models.ts reaches Address through ./address.tsi — the view of a view (emit 14)
    const view = await load(join(dir, "models.ts"), VIEW_NAMESPACE);
    expect(view?.contents).toContain('from "./address.tsi"');
    expect(resolve("./address.tsi", join(dir, "models.ts"), VIEW_NAMESPACE)).toEqual({
      path: join(dir, "address.ts"),
      namespace: VIEW_NAMESPACE,
    });
    // the config-graph guard reads the importer's basename through the prefix too
    expect(() => resolve("./shapes.tsi", join(dir, "nola.config.ts"), VIEW_NAMESPACE)).toThrow(/NOLA3012/);
  });

  it("a syntax error fails the import with the code, the file and the message", async () => {
    const dir = tmpProject();
    setConfigEvaluator(async () => ({ model: {} }));
    writeFileSync(join(dir, "broken.tsi"), "infer function f(.x: string) {\n  return ask ..;\n}\n");
    const { load } = setup();
    await expect(load(join(dir, "broken.tsi"))).rejects.toThrow(/broken\.tsi: NOLA1\d{3}: /);
  });
});

describe("nola() — bundle mode (Bun.build: a build config)", () => {
  it("appends the wiring import for an app target and serves the wiring module in its namespace", async () => {
    const dir = tmpProject();
    setConfigEvaluator(async () => ({ model: {} }));
    setResolver(() => join(dir, "node_modules", "@nola-lang", "runtime", "dist", "index.js"));
    const { resolve, load } = setup({ target: "bun" });
    const out = await load(join(dir, "greet.tsi"));
    const id = wiringIdFor(join(dir, "nola.config.ts"));
    expect(out?.contents.endsWith(`\nimport ${JSON.stringify(id)};\n`)).toBe(true);
    expect(resolve(id, join(dir, "greet.tsi"))).toEqual({ path: id, namespace: WIRING_NAMESPACE });
    const wiring = await load(id, WIRING_NAMESPACE);
    expect(wiring?.loader).toBe("ts");
    expect(wiring?.contents).toContain('nolaRuntime.configure(config, { source: "nola.config.ts" });');
    expect(wiring?.contents).toContain('/nola.config.ts";');
    expect(wiring?.contents).toContain('/@nola-lang/runtime/dist/index.js";');
  });

  it("resolves a view of a view from the bundler's unprefixed importer too", async () => {
    const dir = tmpProject();
    setConfigEvaluator(async () => ({ model: {} }));
    writeFileSync(join(dir, "address.ts"), "export interface Address { city: string }\n");
    writeFileSync(join(dir, "models.ts"), 'import type { Address } from "./address.js";\nexport interface Person { name: string; home: Address }\n');
    const { resolve } = setup({ target: "bun" });
    expect(resolve("./address.tsi", join(dir, "models.ts"), VIEW_NAMESPACE)).toEqual({
      path: join(dir, "address.ts"),
      namespace: VIEW_NAMESPACE,
    });
  });

  it("no wiring for a lib target, under config: false, or in a project without a config", async () => {
    const lib = tmpProject('export default { model: {}, build: { target: "lib" } };\n');
    setConfigEvaluator(async () => ({ model: {}, build: { target: "lib" } }));
    expect((await setup({ target: "bun" }).load(join(lib, "greet.tsi")))?.contents).not.toContain("virtual-nola-config");
    resetProjects();
    setConfigEvaluator(async () => ({ model: {} }));
    const app = tmpProject();
    expect((await setup({ target: "bun" }, { config: false }).load(join(app, "greet.tsi")))?.contents).not.toContain("virtual-nola-config");
    resetProjects();
    const bare = mkdtempSync(join(tmpdir(), "nola-bun-bare-"));
    writeFileSync(join(bare, "greet.tsi"), TSI);
    expect((await setup({ target: "bun" }).load(join(bare, "greet.tsi")))?.contents).not.toContain("virtual-nola-config");
  });

  it("refuses a browser target with NOLA4001 and accepts node", async () => {
    const dir = tmpProject();
    setConfigEvaluator(async () => ({ model: {} }));
    await expect(setup({ target: "browser" }).load(join(dir, "greet.tsi"))).rejects.toThrow(/NOLA4001/);
    resetProjects();
    expect((await setup({ target: "node" }).load(join(dir, "greet.tsi")))?.contents).toContain("virtual-nola-config");
  });
});
