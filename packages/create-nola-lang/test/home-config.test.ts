import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { HOME_CONFIG_FILE, homeConfigPath, readHomeConfig, recordTrialAccount } from "../src/home-config.js";

const tmp = () => mkdtemp(join(tmpdir(), "nola-home-"));
const API = "https://api.nola.sh";
const DEV = "http://127.0.0.1:8787";
const REC = { accountId: "acct_1", issuedAt: "2026-09-02T10:00:00.000Z" };
const REC2 = { accountId: "acct_2", issuedAt: "2026-09-03T10:00:00.000Z" };

const fileOf = (home: string) => join(home, ".nola", HOME_CONFIG_FILE);

describe("home config", () => {
  it("names <home>/.nola/config.json", async () => {
    const home = await tmp();
    expect(homeConfigPath(home)).toBe(fileOf(home));
  });

  it("reads undefined when absent, then writes version 1 with the entry", async () => {
    const home = await tmp();
    expect(await readHomeConfig(home)).toBeUndefined();
    expect(await recordTrialAccount(home, API, REC)).toBe("written");
    expect(JSON.parse(await readFile(fileOf(home), "utf8"))).toEqual({ version: 1, accounts: { [API]: REC } });
    expect(await readHomeConfig(home)).toEqual({ version: 1, accounts: { [API]: REC } });
  });

  it("replaces the entry for the same URL and adds one for another URL", async () => {
    const home = await tmp();
    await recordTrialAccount(home, API, REC);
    await recordTrialAccount(home, DEV, REC2);
    await recordTrialAccount(home, API, REC2);
    expect((await readHomeConfig(home))?.accounts).toEqual({ [API]: REC2, [DEV]: REC2 });
  });

  it("preserves unknown top-level keys across a rewrite", async () => {
    const home = await tmp();
    await mkdir(join(home, ".nola"), { recursive: true });
    await writeFile(fileOf(home), JSON.stringify({ version: 1, telemetry: false, accounts: {} }));
    expect(await recordTrialAccount(home, API, REC)).toBe("written");
    expect(JSON.parse(await readFile(fileOf(home), "utf8"))).toEqual({ version: 1, telemetry: false, accounts: { [API]: REC } });
  });

  it("leaves an unparsable file alone: read undefined, record skipped, bytes untouched", async () => {
    const home = await tmp();
    await mkdir(join(home, ".nola"), { recursive: true });
    await writeFile(fileOf(home), "{ not json\n");
    expect(await readHomeConfig(home)).toBeUndefined();
    expect(await recordTrialAccount(home, API, REC)).toBe("skipped");
    expect(await readFile(fileOf(home), "utf8")).toBe("{ not json\n");
  });

  it("never reads or rewrites a file of an unknown version", async () => {
    const home = await tmp();
    await mkdir(join(home, ".nola"), { recursive: true });
    const newer = JSON.stringify({ version: 2, accounts: { [API]: REC } });
    await writeFile(fileOf(home), newer);
    expect(await readHomeConfig(home)).toBeUndefined();
    expect(await recordTrialAccount(home, API, REC2)).toBe("skipped");
    expect(await readFile(fileOf(home), "utf8")).toBe(newer);
  });

  it("drops malformed entries on read", async () => {
    const home = await tmp();
    await mkdir(join(home, ".nola"), { recursive: true });
    await writeFile(
      fileOf(home),
      JSON.stringify({ version: 1, accounts: { [API]: REC, [DEV]: { accountId: 42 }, junk: "x" } }),
    );
    expect((await readHomeConfig(home))?.accounts).toEqual({ [API]: REC });
  });

  it("skips when the home is unwritable (a file, not a directory) and never throws", async () => {
    const home = join(await tmp(), "not-a-dir");
    await writeFile(home, "x");
    expect(await readHomeConfig(home)).toBeUndefined();
    expect(await recordTrialAccount(home, API, REC)).toBe("skipped");
  });
});
