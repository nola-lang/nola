import { blobModuleUrl, rewriteRuntimeImport, withInlineMap } from "@nola-lang/browser";
import { describe, expect, it } from "vitest";

describe("withInlineMap", () => {
  it("appends an inline base64 map (UTF-8 safe) and a stable sourceURL", () => {
    const map = JSON.stringify({ version: 3, sources: ["nola://p.tsi"], sourcesContent: ["const s = `héllo 🙂`;\n"], mappings: "AAAA" });
    const out = withInlineMap("const s = `héllo 🙂`;\n", map, "nola://playground/p.tsi");
    const lines = out.trimEnd().split("\n");
    expect(lines.at(-2)).toMatch(/^\/\/# sourceMappingURL=data:application\/json;base64,[A-Za-z0-9+/=]+$/);
    expect(lines.at(-1)).toBe("//# sourceURL=nola://playground/p.tsi");
    const base64 = (lines.at(-2) as string).slice("//# sourceMappingURL=data:application/json;base64,".length);
    const decoded = new TextDecoder().decode(Uint8Array.from(atob(base64), (c) => c.charCodeAt(0)));
    expect(decoded).toBe(map);
    expect(out.startsWith("const s = `héllo 🙂`;\n")).toBe(true);
  });
});

describe("rewriteRuntimeImport", () => {
  it("points the runtime import at the host's module and reports every other specifier", () => {
    const js = [
      'import { helper } from "./other.js";',
      "const a = 1;",
      'import { __nola } from "@nola-lang/runtime";',
      'import "side-effect";',
      'const m = await import("./lazy.js");',
      "export {};",
    ].join("\n");
    const out = rewriteRuntimeImport(js, "blob:http://tauri.localhost/runtime");
    expect(out.code).toContain('import { __nola } from "blob:http://tauri.localhost/runtime";');
    expect(out.code).not.toContain("@nola-lang/runtime");
    expect(out.imports).toEqual(["./other.js", "side-effect", "./lazy.js"]);
  });

  it("reports nothing for a program whose only import is the runtime", () => {
    const out = rewriteRuntimeImport('import { __nola } from "@nola-lang/runtime";\nconsole.log(1);\n', "x");
    expect(out.imports).toEqual([]);
  });
});

describe("blobModuleUrl", () => {
  it("is a blob: URL whose text is the module", async () => {
    const url = blobModuleUrl("export const v = 42;\n");
    expect(url.startsWith("blob:")).toBe(true);
    expect(await (await fetch(url)).text()).toBe("export const v = 42;\n");
    URL.revokeObjectURL(url);
  });
});
