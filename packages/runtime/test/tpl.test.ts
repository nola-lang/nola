import { __nola, tpl } from "@nola-lang/runtime";
import { describe, expect, it } from "vitest";

describe("tpl — prompt-friendly template tag", () => {
  it("renders strings as-is and primitives via String()", () => {
    expect(tpl`a ${"b"} ${1} ${true} ${10n}`).toBe("a b 1 true 10");
  });
  it("renders undefined/null as empty", () => {
    expect(tpl`[${undefined}|${null}]`).toBe("[|]");
  });
  it("joins arrays with newlines, formatting each item", () => {
    expect(tpl`${["- a", "- b"]}`).toBe("- a\n- b");
    expect(tpl`${[1, undefined, { x: 1 }]}`).toBe('1\n\n{"x":1}');
  });
  it("renders Date as ISO and other objects as JSON", () => {
    expect(tpl`${new Date("2026-08-17T00:00:00.000Z")}`).toBe("2026-08-17T00:00:00.000Z");
    expect(tpl`${{ a: [1] }}`).toBe('{"a":[1]}');
  });
  it("is exposed on the __nola namespace", () => {
    expect(__nola.tpl).toBe(tpl);
  });
});
