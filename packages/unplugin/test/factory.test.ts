import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { COMPANION_PREFIX } from "../src/companions.js";
import { RESOLVED_WIRING_ID, WIRING_ID, wiringIdFor } from "../src/core.js";
import { unpluginFactory } from "../src/index.js";

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
  writeFileSync(join(dir, "nola.config.ts"), "export default { providers: {} };\n");
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

  it("resolveId serves the wiring id and companions; load returns their code", async () => {
    const dir = tmpProject();
    writeFileSync(join(dir, "models.ts"), "export interface Person { name: string }\n");
    const p = makePlugin();
    const wiringId = wiringIdFor(join(dir, "nola.config.ts"));
    const resolvedWiring = (await p.resolveId?.(wiringId, join(dir, "greet.tsi"))) as string;
    expect(resolvedWiring.startsWith(RESOLVED_WIRING_ID)).toBe(true);
    const companionId = (await p.resolveId?.("./models.nola.js", join(dir, "greet.tsi"))) as string;
    expect(companionId).toBe(`${COMPANION_PREFIX}${join(dir, "models.ts")}`);
    const wiring = (await p.load?.call(hookCtx, resolvedWiring)) as string;
    expect(wiring).toContain("nolaRuntime.configure");
    const companion = (await p.load?.call(hookCtx, companionId)) as string;
    expect(companion).toContain("__nola_type_Person");
  });

  it("companion-of-companion importers (prefixed ids) resolve too", async () => {
    const dir = tmpProject();
    writeFileSync(join(dir, "a.ts"), 'import type { B } from "./b.js";\nexport interface A { b: B }\n');
    writeFileSync(join(dir, "b.ts"), "export interface B { n: number }\n");
    const p = makePlugin();
    const bId = (await p.resolveId?.("./b.nola.js", `${COMPANION_PREFIX}${join(dir, "a.ts")}`)) as string;
    expect(bId).toBe(`${COMPANION_PREFIX}${join(dir, "b.ts")}`);
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
