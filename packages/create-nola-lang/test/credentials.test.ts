import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CREDENTIALS_FILE, credentialsPath, deleteSession, readSession, type Session, writeSession } from "../src/credentials.js";

const tmp = () => mkdtemp(join(tmpdir(), "nola-cred-"));
const API = "https://api.nola.sh";
const DEV = "http://127.0.0.1:8787";
const S1: Session = { accessToken: "at1", refreshToken: "rt1", expiresAt: "2026-09-05T10:00:00.000Z", email: "dev@example.com" };
const S2: Session = { accessToken: "at2", refreshToken: "rt2", expiresAt: "2026-09-06T10:00:00.000Z", email: null };
const fileOf = (home: string) => join(home, ".nola", CREDENTIALS_FILE);

describe("credentials file (signed-in sessions)", () => {
  it("names <home>/.nola/credentials.json", async () => {
    const home = await tmp();
    expect(credentialsPath(home)).toBe(fileOf(home));
  });

  it("absent → undefined; write creates version 1 + the session, owner-only", async () => {
    const home = await tmp();
    expect(await readSession(home, API)).toBeUndefined();
    expect(await writeSession(home, API, S1)).toBe("written");
    expect(JSON.parse(await readFile(fileOf(home), "utf8"))).toEqual({ version: 1, sessions: { [API]: S1 } });
    expect(await readSession(home, API)).toEqual(S1);
    if (process.platform !== "win32") expect((await stat(fileOf(home))).mode & 0o777).toBe(0o600);
  });

  it("a second write on the same URL replaces; a different URL adds; delete removes one and is idempotent", async () => {
    const home = await tmp();
    await writeSession(home, API, S1);
    await writeSession(home, DEV, S2);
    await writeSession(home, API, S2);
    expect(await readSession(home, API)).toEqual(S2);
    expect(await readSession(home, DEV)).toEqual(S2);
    expect(await deleteSession(home, API)).toBe("written");
    expect(await readSession(home, API)).toBeUndefined();
    expect(await readSession(home, DEV)).toEqual(S2);
    expect(await deleteSession(home, API)).toBe("written");
    expect(await deleteSession(await tmp(), API)).toBe("written");
  });

  it("preserves unknown top-level keys of a file", async () => {
    const home = await tmp();
    await mkdir(join(home, ".nola"), { recursive: true });
    await writeFile(fileOf(home), JSON.stringify({ version: 1, future: { x: 1 }, sessions: {} }));
    await writeSession(home, API, S1);
    const parsed = JSON.parse(await readFile(fileOf(home), "utf8"));
    expect(parsed.future).toEqual({ x: 1 });
    expect(parsed.sessions[API]).toEqual(S1);
  });

  it("a file of a version this build does not understand is left alone: read undefined, write and delete skipped", async () => {
    const home = await tmp();
    await mkdir(join(home, ".nola"), { recursive: true });
    const foreign = JSON.stringify({ version: 99, sessions: { [API]: S1 } });
    await writeFile(fileOf(home), foreign);
    expect(await readSession(home, API)).toBeUndefined();
    expect(await writeSession(home, API, S1)).toBe("skipped");
    expect(await deleteSession(home, API)).toBe("skipped");
    expect(await readFile(fileOf(home), "utf8")).toBe(foreign);
  });

  it("an unparsable file is left byte-identical: read undefined, write and delete skipped", async () => {
    const home = await tmp();
    await mkdir(join(home, ".nola"), { recursive: true });
    await writeFile(fileOf(home), "{ not json");
    expect(await readSession(home, API)).toBeUndefined();
    expect(await writeSession(home, API, S1)).toBe("skipped");
    expect(await deleteSession(home, API)).toBe("skipped");
    expect(await readFile(fileOf(home), "utf8")).toBe("{ not json");
  });

  it("ignores a malformed session entry and never throws on an unwritable home", async () => {
    const home = await tmp();
    await mkdir(join(home, ".nola"), { recursive: true });
    await writeFile(fileOf(home), JSON.stringify({ version: 1, sessions: { [API]: { accessToken: "", refreshToken: "rt" } } }));
    expect(await readSession(home, API)).toBeUndefined();
    const blocked = await tmp();
    await writeFile(join(blocked, ".nola"), "a file where the directory should be");
    expect(await readSession(blocked, API)).toBeUndefined();
    expect(await writeSession(blocked, API, S1)).toBe("skipped");
  });
});
