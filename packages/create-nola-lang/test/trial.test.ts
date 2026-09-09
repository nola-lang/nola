import { existsSync } from "node:fs";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { applyTrial, ensureEnvIgnored, hasEnvKey, TRIAL_CONFIG_URL, writeEnvKey } from "../src/trial.js";

const tmp = () => mkdtemp(join(tmpdir(), "nola-trial-"));
const KEY = `nola_sk_${"b".repeat(40)}`;

describe("applyTrial", () => {
  it("writes .env, a guarded .gitignore and the trial config into a bare directory", async () => {
    const dir = await tmp();
    const result = await applyTrial(dir, { apiKey: KEY, hasConfig: false });
    expect(result).toEqual({ wrote: [".env", ".gitignore", "nola.config.ts"], skipped: [] });
    expect(await readFile(join(dir, ".env"), "utf8")).toBe(`NOLA_API_KEY=${KEY}\n`);
    expect(await readFile(join(dir, ".gitignore"), "utf8")).toBe(".env\n.env.*\n");
    expect(await readFile(join(dir, "nola.config.ts"), "utf8")).toBe(await readFile(TRIAL_CONFIG_URL, "utf8"));
  });

  it("appends the key to an existing .env and the missing ignore lines to an existing .gitignore", async () => {
    const dir = await tmp();
    await writeFile(join(dir, ".env"), "OPENAI_API_KEY=sk-x"); // no trailing newline
    await writeFile(join(dir, ".gitignore"), "node_modules/\ndist/\n\n.env"); // starter shape before this change
    const result = await applyTrial(dir, { apiKey: KEY, hasConfig: true });
    expect(result.wrote).toEqual([".env", ".gitignore"]);
    expect(await readFile(join(dir, ".env"), "utf8")).toBe(`OPENAI_API_KEY=sk-x\nNOLA_API_KEY=${KEY}\n`);
    expect(await readFile(join(dir, ".gitignore"), "utf8")).toBe("node_modules/\ndist/\n\n.env\n\n.env.*\n");
    expect(result.skipped).toEqual(['nola.config.ts already exists — set `model: nola.infer()` (nola from @nola-lang/runtime) to use the trial key']);
    expect(existsSync(join(dir, "nola.config.ts"))).toBe(false); // hasConfig means: not ours to write
  });

  it("leaves an existing NOLA_API_KEY alone and does not duplicate ignore lines", async () => {
    const dir = await tmp();
    await writeFile(join(dir, ".env"), "NOLA_API_KEY=nola_sk_old\n");
    await writeFile(join(dir, ".gitignore"), ".env\n.env.*\n");
    const result = await applyTrial(dir, { apiKey: KEY, hasConfig: false });
    expect(result.wrote).toEqual(["nola.config.ts"]);
    expect(result.skipped).toEqual([".env already sets NOLA_API_KEY — left untouched; the new trial key was not written"]);
    expect(await readFile(join(dir, ".env"), "utf8")).toBe("NOLA_API_KEY=nola_sk_old\n");
    expect(await readFile(join(dir, ".gitignore"), "utf8")).toBe(".env\n.env.*\n");
  });
});

describe("writeEnvKey / hasEnvKey", () => {
  it("writes .env ONLY (no .gitignore), reports an existing key, never overwrites; ensureEnvIgnored is the separate guard", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nola-envkey-"));
    expect(await hasEnvKey(dir)).toBe(false);
    expect(await writeEnvKey(dir, "nola_sk_one")).toEqual({ wrote: [".env"], skipped: [] });
    expect(await readFile(join(dir, ".env"), "utf8")).toBe("NOLA_API_KEY=nola_sk_one\n");
    expect(existsSync(join(dir, ".gitignore"))).toBe(false);
    expect(await ensureEnvIgnored(dir)).toEqual([".gitignore"]);
    expect((await readFile(join(dir, ".gitignore"), "utf8")).split("\n")).toEqual(expect.arrayContaining([".env", ".env.*"]));
    expect(await ensureEnvIgnored(dir)).toEqual([]);
    expect(await hasEnvKey(dir)).toBe(true);
    const again = await writeEnvKey(dir, "nola_sk_two");
    expect(again.wrote).toEqual([]);
    expect(again.skipped[0]).toContain("already sets NOLA_API_KEY");
    expect(await readFile(join(dir, ".env"), "utf8")).toBe("NOLA_API_KEY=nola_sk_one\n");
    // replace: the line is rewritten in place, other lines and an `export ` prefix survive
    await writeFile(join(dir, ".env"), "A=1\nexport NOLA_API_KEY=nola_sk_one # note\nB=2\n");
    expect((await writeEnvKey(dir, "nola_sk_two", { replace: true })).wrote).toEqual([".env"]);
    expect(await readFile(join(dir, ".env"), "utf8")).toBe("A=1\nexport NOLA_API_KEY=nola_sk_two\nB=2\n");
  });
});

