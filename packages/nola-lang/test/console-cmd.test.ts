import { tagPalette } from "create-nola-lang";
import { afterEach, describe, expect, it } from "vitest";
import {
  formatConsoleBanner,
  formatIngestLine,
  nodeSupportsConsole,
  suppressSqliteExperimentalWarning,
} from "../src/console.js";

describe("nola console helpers", () => {
  it("nodeSupportsConsole gates on 22.13", () => {
    expect(nodeSupportsConsole("22.12.0")).toBe(false);
    expect(nodeSupportsConsole("22.13.0")).toBe(true);
    expect(nodeSupportsConsole("23.4.0")).toBe(true);
    expect(nodeSupportsConsole("21.9.0")).toBe(false);
  });

  it("formats the startup banner with url, the console home and the connect hint", () => {
    const home = "/home/me/.nola/console";
    const banner = formatConsoleBanner({ url: "http://127.0.0.1:4141", home });
    expect(banner).toContain("Nola Console started");
    expect(banner).toContain("http://127.0.0.1:4141");
    expect(banner).toContain(`Home:     ${home}`); // the root folder, not the database file inside it
    expect(banner).not.toContain("console.db");
    expect(banner).not.toContain("Storage:");
    expect(banner).toContain('Enable tracing with `telemetry: nola.tracer("http://127.0.0.1:4141")` in nola.config.ts');
    expect(banner).not.toContain("NOLA_TRACING_URL"); // the env var and terminalTrace are noise here — one line, one thing
    expect(banner).not.toContain("terminalTrace");
    expect(banner).not.toContain("nola.infer(");
    expect(banner).not.toContain("hooks:");
    expect(banner).not.toContain("nola({");
    expect(banner).not.toContain("wrap your provider");
    expect(banner).not.toContain("console:");
    expect(banner).toContain("Ctrl+C");
    expect(banner).not.toMatch(/<\/?(heading|dim|command|path)>/); // plain by default — what pipes and tests see
  });

  it("colours the banner by role: bold title, cyan url, bold home path, dim hints", () => {
    const banner = formatConsoleBanner({ url: "http://127.0.0.1:4141", home: "/home/me/.nola/console" }, tagPalette);
    expect(banner).toContain("<heading>Nola Console started</heading>");
    expect(banner).toContain("<dim>Local:</dim>    <command>http://127.0.0.1:4141</command>");
    expect(banner).toContain("<dim>Home:</dim>     <path>/home/me/.nola/console</path>");
    expect(banner).toContain("<dim>Press Ctrl+C to stop</dim>");
  });
});

describe("suppressSqliteExperimentalWarning", () => {
  const original = process.emitWarning;
  afterEach(() => {
    process.emitWarning = original;
  });

  const captured = (): string[] => {
    const seen: string[] = [];
    process.emitWarning = ((warning: string | Error) => {
      seen.push(typeof warning === "string" ? warning : warning.message);
    }) as typeof process.emitWarning;
    return seen;
  };

  it("drops the node:sqlite ExperimentalWarning and nothing else", () => {
    const seen = captured();
    suppressSqliteExperimentalWarning();
    process.emitWarning("SQLite is an experimental feature and might change at any time", "ExperimentalWarning");
    process.emitWarning("SQLite is an experimental feature and might change at any time", { type: "ExperimentalWarning" });
    process.emitWarning("Something else", "ExperimentalWarning");
    process.emitWarning("SQLite mentioned in a deprecation", "DeprecationWarning");
    expect(seen).toEqual(["Something else", "SQLite mentioned in a deprecation"]);
  });
});

describe("formatIngestLine", () => {
  it("is core's formatter re-exported — the terminal sink and the console print the same lines", async () => {
    const core = await import("@nola-lang/core");
    expect(formatIngestLine).toBe(core.formatIngestLine);
  });
});
