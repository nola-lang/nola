import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CONFIG_DISCOVERY_TTL_MS, discoverCompilerConfig } from "@nola-lang/language-core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// discoverCompilerConfig runs on EVERY compile of every open file — each
// keystroke. The walk up to the nearest nola.config.ts is one existsSync per
// ancestor directory plus a statSync, so it is memoized per start directory
// for a short while: a config edit still lands on the next recompile (the
// mtime check runs on every hit), a config CREATED or REMOVED lands within
// the TTL. The clock is injected so the test never sleeps.
describe("discoverCompilerConfig", () => {
  let root: string;
  let src: string;
  let configPath: string;
  let t = 1_000_000;

  const config = (mode: string) => `export default { compiler: { underivableContextType: "${mode}" } };\n`;
  const at = (time: number) => discoverCompilerConfig(join(src, "main.tsi"), time);

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "nola-compiler-config-"));
    src = join(root, "src");
    mkdirSync(src);
    configPath = join(root, "nola.config.ts");
    t += 10 * CONFIG_DISCOVERY_TTL_MS; // a fresh window per test: the memo is module-level
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("finds the nearest config above the file", () => {
    writeFileSync(configPath, config("prune"));
    expect(at(t)).toEqual({ underivableContextType: "prune" });
  });

  it("an edited config lands on the very next call (the mtime check is not memoized)", () => {
    writeFileSync(configPath, config("prune"));
    expect(at(t)).toEqual({ underivableContextType: "prune" });
    writeFileSync(configPath, config("omit"));
    utimesSync(configPath, new Date(t + 5_000), new Date(t + 5_000));
    expect(at(t + 1)).toEqual({ underivableContextType: "omit" });
  });

  it("a REMOVED config is gone on the very next call (the stat fails, the location is forgotten)", () => {
    writeFileSync(configPath, config("prune"));
    expect(at(t)).toEqual({ underivableContextType: "prune" });
    rmSync(configPath);
    expect(at(t + 1)).toEqual({});
    // and re-creating it is seen at once: the miss was not memoized
    writeFileSync(configPath, config("omit"));
    expect(at(t + 2)).toEqual({ underivableContextType: "omit" });
  });

  it("a config CREATED inside the TTL after a miss is seen once the TTL passes", () => {
    expect(at(t)).toEqual({});
    writeFileSync(configPath, config("prune"));
    expect(at(t + 1)).toEqual({});
    expect(at(t + CONFIG_DISCOVERY_TTL_MS + 1)).toEqual({ underivableContextType: "prune" });
  });
});
