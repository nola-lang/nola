import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cmdBuild, cmdCheck } from "nola-lang";
import { describe, expect, it } from "vitest";

const TSCONFIG = JSON.stringify({
  compilerOptions: { strict: true, module: "NodeNext", moduleResolution: "NodeNext", noEmit: true, skipLibCheck: true },
  include: ["src"],
});

const EVENTS = [
  'export interface Refund { kind: "refund"; amount: number }',
  'export interface Chargeback { kind: "chargeback"; reason: string; at: Date }',
  "export type PaymentEvent = Refund | Chargeback;",
  "export type Draft = Partial<Refund>;",
  "export infer function classify(.message: string) {",
  "  return ask ..`the event`<PaymentEvent>;",
  "}",
  "",
].join("\n");

async function project(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "nola-build-derive-"));
  await mkdir(join(dir, "src"), { recursive: true });
  await writeFile(join(dir, "tsconfig.json"), TSCONFIG);
  for (const [rel, text] of Object.entries(files)) await writeFile(join(dir, rel), text);
  return dir;
}

describe("nola build / nola check derive through the checker (emit 15)", () => {
  it("build writes finalized bodies: a discriminated union and a Partial; no inert accessor survives", async () => {
    const dir = await project({ "src/events.tsi": EVENTS });
    const { errors } = await cmdBuild(dir, join(dir, "dist"));
    expect(errors).toEqual([]);
    const js = await readFile(join(dir, "dist", "src", "events.tsi.js"), "utf8");
    expect(js).toContain("__nola.types.union([");
    expect(js).toContain('__nola.types.enum(["refund"])');
    expect(js).toContain("__nola.types.optional(__nola.types.number())");
    expect(js).toContain("__nola.types.date()");
    expect(js).not.toContain("void 0 as never");
    expect(js).not.toContain("undefined as never");
  });

  it("check passes on the same project and reports NOLA2002 at the source for an underivable <T>", async () => {
    const dir = await project({ "src/events.tsi": EVENTS });
    expect((await cmdCheck(dir)).errors).toEqual([]);
    await writeFile(join(dir, "src", "bad.tsi"), "export type Bad = Map<string, number>;\nconst x = ..`q`<Bad>;\n");
    const { errors } = await cmdCheck(dir);
    expect(errors.join("\n")).toMatch(/bad\.tsi:2:\d+ NOLA2002/);
    expect(errors.join("\n")).toContain("Map<string, number>");
  });

  it("an underivable EXPORTED type is an UnsupportedType value: using it from plain TS fails check with the reason", async () => {
    const dir = await project({
      "src/weird.tsi": "export type Weird = Map<string, number>;\n",
      "src/use.ts": 'import { Weird } from "./weird.tsi";\nexport const s = Weird.toJsonSchema();\n',
    });
    const { errors } = await cmdCheck(dir);
    expect(errors.join("\n")).toContain("use.ts:2");
    expect(errors.join("\n")).toContain("unsupported type Map<string, number>");
  });

  it("the view of a plain module is finalized in dist and in its declaration", async () => {
    const dir = await project({
      "src/models.ts": 'export interface Q { k: "a" | "b"; n?: number }\nexport type Weird = Map<string, number>;\n',
      "src/report.tsi": 'import type { Q } from "./models.js";\nconst i = ..`q`<Q>;\n',
    });
    const { errors } = await cmdBuild(dir, join(dir, "dist"));
    expect(errors).toEqual([]);
    const js = await readFile(join(dir, "dist", "src", "models.tsi.js"), "utf8");
    expect(js).toContain('__nola.types.enum(["a", "b"])');
    expect(js).toContain("__nola.types.unsupported(");
    const dts = await readFile(join(dir, "dist", "src", "models.tsi.d.ts"), "utf8");
    expect(dts).toContain("export declare const Q:");
    expect(dts).toMatch(/UnsupportedType<"unsupported type Map<string, number>/);
  });
});
