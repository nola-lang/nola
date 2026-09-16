import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { RESOLVED_WIRING_ID, WIRING_ID, wiringIdFor } from "../src/core.js";
import { unpluginFactory } from "../src/index.js";
import { VIEW_PREFIX } from "../src/views.js";

const TSI = "infer function greet(.name: string) {\n  return ask ..`say hello`<string>;\n}\n";

type Hook = (...args: unknown[]) => unknown;
type PluginShape = {
  name: string;
  transformInclude?: (id: string) => boolean;
  transform?: Hook;
  resolveId?: Hook;
  load?: Hook;
  vite?: { transform: { handler: Hook } };
};

function makePlugin(framework = "rollup"): PluginShape {
  return unpluginFactory({}, { framework } as never) as unknown as PluginShape;
}

function tmpProject(): string {
  const dir = mkdtempSync(join(tmpdir(), "nola-factory-"));
  writeFileSync(join(dir, "nola.config.ts"), "export default { model: {} };\n");
  writeFileSync(join(dir, "greet.tsi"), TSI);
  return dir;
}

const hookCtx = {
  error: (m: unknown): never => {
    throw m instanceof Error ? m : new Error(String(m));
  },
  addWatchFile: () => {},
};

describe("unpluginFactory", () => {
  it("is named nola and includes only .tsi in transform", () => {
    const p = makePlugin();
    expect(p.name).toBe("nola");
    expect(p.transformInclude?.("/x/a.tsi")).toBe(true);
    expect(p.transformInclude?.("/x/a.ts")).toBe(false);
  });

  it("transform lowers .tsi and appends the wiring import", async () => {
    const dir = tmpProject();
    const p = makePlugin();
    const out = (await p.transform?.call(hookCtx, TSI, join(dir, "greet.tsi"))) as { code: string };
    expect(out.code).toContain("__nola.useRuntime");
    expect(out.code).toContain(WIRING_ID);
  });

  it("resolveId serves the wiring id and views; load returns their code", async () => {
    const dir = tmpProject();
    writeFileSync(join(dir, "models.ts"), "export interface Person { name: string }\n");
    const p = makePlugin();
    const wiringId = wiringIdFor(join(dir, "nola.config.ts"));
    const resolvedWiring = (await p.resolveId?.(wiringId, join(dir, "greet.tsi"))) as string;
    expect(resolvedWiring.startsWith(RESOLVED_WIRING_ID)).toBe(true);
    const viewId = (await p.resolveId?.("./models.tsi", join(dir, "greet.tsi"))) as string;
    expect(viewId).toBe(`${VIEW_PREFIX}${join(dir, "models.ts")}`);
    const wiring = (await p.load?.call(hookCtx, resolvedWiring)) as string;
    expect(wiring).toContain("nolaRuntime.configure");
    const view = (await p.load?.call(hookCtx, viewId)) as string;
    expect(view).toContain("__nola_type_Person");
    expect(view).toMatch(/const Person = __nola_type_Person\(\)/);
  });

  it("view-of-view importers (prefixed ids) resolve too", async () => {
    const dir = tmpProject();
    writeFileSync(join(dir, "a.ts"), 'import type { B } from "./b.js";\nexport interface A { b: B }\n');
    writeFileSync(join(dir, "b.ts"), "export interface B { n: number }\n");
    const p = makePlugin();
    const bId = (await p.resolveId?.("./b.tsi", `${VIEW_PREFIX}${join(dir, "a.ts")}`)) as string;
    expect(bId).toBe(`${VIEW_PREFIX}${join(dir, "b.ts")}`);
  });
});

describe("client guard (vite override)", () => {
  it("errors with NOLA4001 when transforming .tsi without ssr; transforms with ssr", async () => {
    const dir = tmpProject();
    const p = makePlugin("vite");
    const handler = p.vite?.transform.handler as Hook;
    await expect(
      Promise.resolve(handler.call(hookCtx, TSI, join(dir, "greet.tsi"), { ssr: false })),
    ).rejects.toThrow(/NOLA4001/);
    const ok = (await handler.call(hookCtx, TSI, join(dir, "greet.tsi"), { ssr: true })) as { code: string };
    expect(ok.code).toContain("__nola.useRuntime");
  });
});

describe("client guard (webpack apply-time flag)", () => {
  it("a browser-target compiler makes .tsi transform fail NOLA4001", async () => {
    const dir = tmpProject();
    const p = unpluginFactory({}, { framework: "webpack" } as never) as unknown as PluginShape & {
      webpack?: (compiler: { options: { target: unknown } }) => void;
    };
    p.webpack?.({ options: { target: "web" } });
    await expect(
      Promise.resolve(p.transform?.call(hookCtx, TSI, join(dir, "greet.tsi"))),
    ).rejects.toThrow(/NOLA4001/);
  });

  it("a node-target compiler transforms normally", async () => {
    const dir = tmpProject();
    const p = unpluginFactory({}, { framework: "webpack" } as never) as unknown as PluginShape & {
      webpack?: (compiler: { options: { target: unknown } }) => void;
    };
    p.webpack?.({ options: { target: "node22" } });
    const out = (await p.transform?.call(hookCtx, TSI, join(dir, "greet.tsi"))) as { code: string };
    expect(out.code).toContain("__nola.useRuntime");
  });
});

describe("type-only dependencies (emit 15)", () => {
  it("transforming a .tsi that derives from ./models.js registers models.ts as a watch file", async () => {
    const dir = tmpProject();
    writeFileSync(join(dir, "models.ts"), "export interface Person { name: string; age?: number }\n");
    writeFileSync(
      join(dir, "report.tsi"),
      'import type { Person } from "./models.js";\nexport type Half = Partial<Person>;\nconst i = ..`who`<Person>;\n',
    );
    const watched: string[] = [];
    const ctx = { ...hookCtx, addWatchFile: (f: string) => watched.push(f.replace(/\\/g, "/")) };
    const p = makePlugin();
    const src = 'import type { Person } from "./models.js";\nexport type Half = Partial<Person>;\nconst i = ..`who`<Person>;\n';
    const out = (await p.transform?.call(ctx, src, join(dir, "report.tsi"))) as { code: string };
    expect(out.code).toContain("__nola.types.optional(__nola.types.number())"); // Half derived through the checker
    expect(out.code).toContain('from "./models.tsi"');
    expect(watched.some((w) => w.endsWith("/models.ts"))).toBe(true);
  });
});
