import pc from "picocolors";
import { describe, expect, it } from "vitest";
import { ansi, type Palette, paletteFrom, plain, tagPalette } from "../src/palette.js";

const ROLES: Array<keyof Palette> = ["heading", "command", "flag", "path", "dim", "ok", "warn", "error"];

describe("palette", () => {
  it("plain leaves every role's text untouched", () => {
    for (const role of ROLES) expect(plain[role]("x y")).toBe("x y");
  });

  it("paletteFrom wraps each role in ANSI escapes when colours are on", () => {
    const forced = paletteFrom(pc.createColors(true));
    const ESC = "";
    const wrapped = new RegExp(`^${ESC}\\[\\d+m.*x.*${ESC}\\[\\d+m$`);
    for (const role of ROLES) {
      expect(forced[role]("x"), role).toMatch(wrapped);
    }
    expect(forced.error("x")).toContain(`${ESC}[31m`);
    expect(forced.ok("x")).toContain(`${ESC}[32m`);
    expect(forced.warn("x")).toContain(`${ESC}[33m`);
  });

  it("the default palette follows picocolors' own NO_COLOR / FORCE_COLOR / TTY decision", () => {
    expect(ansi.error("x")).toBe(paletteFrom(pc).error("x"));
  });

  it("tagPalette marks roles with readable tags for tests", () => {
    expect(tagPalette.error("x")).toBe("<error>x</error>");
    expect(tagPalette.dim("x")).toBe("<dim>x</dim>");
  });
});
