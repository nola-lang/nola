import { describe, expect, it } from "vitest";
import { materializeTools, toolSource, toolSpreadSource, toolVerdicts } from "../src/intents/tool-use/tool-group.js";
import { inferTypes as t } from "../src/types/infer-type.js";

const searchArgs = t.object({ dir: t.string() });
const readArgs = t.object({ path: t.string() });
function search(dir: string) {
  return [dir];
}
function readFile(path: string) {
  return path;
}
const fileTools = { search, readFile, limit: 10 };
const members = toolVerdicts.members({ search: searchArgs, readFile: readArgs });

const names = (r: ReturnType<typeof materializeTools>) => r.entries.map((e) => e.name);

// Materialization (spec 2026-10-09 §3.5): sources become today's ToolEntry
// list; names follow §1.4; a shape that disagrees with the verdict, an empty
// name or a collision is an error message (the context raises NOLA3022).
describe("materializeTools", () => {
  it("a function with a written name keeps it; a bound receiver keeps `this`", () => {
    const obj = {
      n: 2,
      scale(x: number) {
        return x * this.n;
      },
    };
    const r = materializeTools([toolSource(obj.scale, t.object({ x: t.number() }), "obj.scale", obj)]);
    expect(r.error).toBeUndefined();
    expect(names(r)).toEqual(["obj.scale"]);
    expect((r.entries[0]?.call as (x: number) => number)(3)).toBe(6);
  });

  it("a function without a written name is named by the function, `bound ` prefixes stripped", () => {
    const twice = search.bind(null).bind(null);
    expect(twice.name).toBe("bound bound search");
    expect(names(materializeTools([toolSource(twice, searchArgs)]))).toEqual(["search"]);
  });

  it("an anonymous function without a written name is an error naming the position", () => {
    const r = materializeTools([toolSource(search, searchArgs, "search"), toolSource(() => 1, searchArgs)]);
    expect(r.error).toMatch(/entry 2 .*has no name/);
  });

  it("a bare group names its members `<written>.<key>`, in the verdict's order, bound to the group", () => {
    const r = materializeTools([toolSource(fileTools, members, "fileTools")]);
    expect(r.error).toBeUndefined();
    expect(names(r)).toEqual(["fileTools.search", "fileTools.readFile"]);
    expect(r.entries[0]?.args).toBe(searchArgs);
  });

  it("a key is the name even when the function is named otherwise (a re-export under another name)", () => {
    const r = materializeTools([toolSource({ find: search }, toolVerdicts.members({ find: searchArgs }), "fileTools")]);
    expect(names(r)).toEqual(["fileTools.find"]);
  });

  it("a spread group names its members by key alone", () => {
    expect(names(materializeTools([toolSpreadSource(fileTools, members)]))).toEqual(["search", "readFile"]);
  });

  it("a tuple names elements by the function; bare prefixes the written text", () => {
    const tuple = toolVerdicts.tuple([searchArgs, readArgs]);
    expect(names(materializeTools([toolSource([search, readFile], tuple, "tools")]))).toEqual(["tools.search", "tools.readFile"]);
    expect(names(materializeTools([toolSpreadSource([search, readFile], tuple)]))).toEqual(["search", "readFile"]);
  });

  it("an array shares one contract across its elements; an unnamed element is an error", () => {
    const array = toolVerdicts.array(readArgs);
    const ok = materializeTools([toolSpreadSource([readFile], array)]);
    expect(names(ok)).toEqual(["readFile"]);
    expect(ok.entries[0]?.args).toBe(readArgs);
    expect(materializeTools([toolSource([readFile, () => ""], array, "tools")]).error).toMatch(/element 2 of 'tools' has no name/);
  });

  it("a live shape that disagrees with the verdict is an error: not a function, not an array, a wrong length, a key that is not a function", () => {
    expect(materializeTools([toolSource(1, searchArgs, "one")]).error).toMatch(/'one' is not a function/);
    expect(materializeTools([toolSource(search, members, "fileTools")]).error).toMatch(/'fileTools' is not an object of functions/);
    expect(materializeTools([toolSource([search], toolVerdicts.tuple([searchArgs, readArgs]), "tools")]).error).toMatch(/'tools' has 1 element.*2/);
    expect(materializeTools([toolSource({ search: 1 }, members, "fileTools")]).error).toMatch(/'fileTools\.search' is not a function/);
    expect(materializeTools([toolSpreadSource(search, searchArgs)]).error).toMatch(/spread a group/);
    expect(materializeTools([toolSource(fileTools, members)]).error).toMatch(/name it or spread it/);
  });

  it("two tools with one wire name are an error naming both", () => {
    const r = materializeTools([toolSpreadSource(fileTools, members), toolSpreadSource({ search }, toolVerdicts.members({ search: searchArgs }))]);
    expect(r.error).toMatch(/'search' .* shares the wire name 'search'/);
    const ok = materializeTools([toolSource(fileTools, members, "fileTools"), toolSource({ search }, toolVerdicts.members({ search: searchArgs }), "dbTools")]);
    expect(names(ok)).toEqual(["fileTools.search", "fileTools.readFile", "dbTools.search"]);
  });

  it("materializeTools keeps one entry for the same function listed twice under one name, and refuses two functions under one name", () => {
    // the ask sequence (spec 2026-10-12 §3.6): the lists of one ask union; a tool offered in two of them is one tool
    const a = (dir: string) => [dir];
    const b = (dir: string) => [dir];
    const args = t.object({ dir: t.string() });
    const same = materializeTools([toolSource(a, args, "search"), toolSource(a, args, "search")]);
    expect(same.error).toBeUndefined();
    expect(same.entries.map((e) => e.name)).toEqual(["search"]);
    const api = { search: a };
    const bound = materializeTools([toolSource(api.search, args, "api.search", api), toolSource(api.search, args, "api.search", api)]);
    expect(bound.entries.map((e) => e.name)).toEqual(["api.search"]);
    expect(materializeTools([toolSource(a, args, "search"), toolSource(b, args, "search")]).error).toContain("shares the wire name");
  });

  it("a ready ToolEntry passes through untouched", () => {
    const entry = { name: "search", call: search, args: searchArgs };
    expect(materializeTools([entry]).entries[0]).toBe(entry);
  });
});
