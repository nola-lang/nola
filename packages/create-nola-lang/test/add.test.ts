import { existsSync } from "node:fs";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { addNola } from "../src/add.js";

const tmp = () => mkdtemp(join(tmpdir(), "nola-add-"));

async function bareProject(pkg: object): Promise<string> {
  const dir = await tmp();
  await writeFile(join(dir, "package.json"), `${JSON.stringify(pkg, null, 2)}\n`);
  return dir;
}

describe("addNola", () => {
  it("writes nola.config.ts and merges the four deps into a bare project", async () => {
    const dir = await bareProject({ name: "existing-api", private: true });
    const result = await addNola(dir, { version: "0.1.0-alpha.0" });
    expect(result.alreadySetUp).toBe(false);
    expect(result.wrote).toEqual(["nola.config.ts", "package.json"]);
    expect(existsSync(join(dir, "nola.config.ts"))).toBe(true);
    const pkg = JSON.parse(await readFile(join(dir, "package.json"), "utf8"));
    expect(pkg.dependencies["@nola-lang/runtime"]).toBe("^0.1.0-alpha.0");
    expect(pkg.dependencies["@nola-lang/providers"]).toBe("^0.1.0-alpha.0");
    expect(pkg.devDependencies["nola-lang"]).toBe("^0.1.0-alpha.0");
    expect(pkg.devDependencies.typescript).toBe("^5.6.0");
    expect(pkg.name).toBe("existing-api"); // never renamed
  });

  it("writes the empty template's config verbatim", async () => {
    const dir = await bareProject({ name: "x" });
    await addNola(dir, { version: "0.1.0-alpha.0" });
    const written = await readFile(join(dir, "nola.config.ts"), "utf8");
    const template = await readFile(new URL("../templates/empty/nola.config.ts", import.meta.url), "utf8");
    expect(written).toBe(template);
  });

  it("keeps existing dep ranges and reports them", async () => {
    const dir = await bareProject({
      name: "x",
      dependencies: { "@nola-lang/runtime": "0.0.9" },
      devDependencies: { typescript: "~5.5.0" },
    });
    const result = await addNola(dir, { version: "0.1.0-alpha.0" });
    const pkg = JSON.parse(await readFile(join(dir, "package.json"), "utf8"));
    expect(pkg.dependencies["@nola-lang/runtime"]).toBe("0.0.9");
    expect(pkg.devDependencies.typescript).toBe("~5.5.0");
    expect(result.added).toEqual(["@nola-lang/providers@^0.1.0-alpha.0", "nola-lang@^0.1.0-alpha.0"]);
    expect(result.skipped.join("\n")).toContain("typescript already present (~5.5.0)");
  });

  it("leaves an existing nola.config.ts untouched", async () => {
    const dir = await bareProject({ name: "x" });
    await writeFile(join(dir, "nola.config.ts"), "// mine\n");
    const result = await addNola(dir, { version: "0.1.0-alpha.0" });
    expect(await readFile(join(dir, "nola.config.ts"), "utf8")).toBe("// mine\n");
    expect(result.skipped.join("\n")).toContain("nola.config.ts already exists");
  });

  it("is a no-op on a fully set-up project", async () => {
    const dir = await bareProject({ name: "x" });
    await addNola(dir, { version: "0.1.0-alpha.0" });
    const manifestBefore = await readFile(join(dir, "package.json"), "utf8");
    const again = await addNola(dir, { version: "0.1.0-alpha.0" });
    expect(again.alreadySetUp).toBe(true);
    expect(again.wrote).toEqual([]);
    expect(again.added).toEqual([]);
    expect(await readFile(join(dir, "package.json"), "utf8")).toBe(manifestBefore);
  });

  it("errors without a package.json", async () => {
    const dir = await tmp();
    await expect(addNola(dir)).rejects.toThrow(/no package\.json/);
  });

  it("errors on an unparseable package.json", async () => {
    const dir = await tmp();
    await writeFile(join(dir, "package.json"), "{ nope");
    await expect(addNola(dir)).rejects.toThrow(/could not parse/);
  });
});
