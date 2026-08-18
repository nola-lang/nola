import { describe, expect, it } from "vitest";
import { collectExampleFromDisk, devExamplesDir, rewriteExamplePackageJson } from "../src/examples.js";

describe("dev-mode example acquisition", () => {
  it("finds the checkout's examples dir (we ARE in the nola-monorepo)", async () => {
    const dir = await devExamplesDir();
    expect(dir).not.toBeNull();
    expect(dir?.replaceAll("\\", "/")).toMatch(/\/examples$/);
  });

  it("collects an example's committed files, excluding build output", async () => {
    const dir = (await devExamplesDir()) as string;
    const files = await collectExampleFromDisk(dir, "extract-resume");
    expect(files.has("package.json")).toBe(true);
    expect(files.has("src/main.ts")).toBe(true);
    expect(files.has("src/resume.tsi")).toBe(true);
    for (const path of files.keys()) {
      expect(path).not.toMatch(/^(node_modules|dist)\//);
      expect(path).not.toMatch(/\.tsbuildinfo$/);
    }
  });

  it("throws on an unknown example name", async () => {
    const dir = (await devExamplesDir()) as string;
    await expect(collectExampleFromDisk(dir, "no-such-example")).rejects.toThrow(/unknown example/);
  });
});

describe("rewriteExamplePackageJson", () => {
  it("sets the project name and pins workspace deps to ^version", () => {
    const input = JSON.stringify({
      name: "nola-example-extract-resume",
      dependencies: { "@nola-lang/providers": "*", "@nola-lang/runtime": "*", "left-pad": "^1.0.0" },
      devDependencies: { "nola-lang": "*", typescript: "^5.6.0" },
    });
    const out = JSON.parse(rewriteExamplePackageJson(input, { name: "my-app", version: "0.1.0-alpha.0" }));
    expect(out.name).toBe("my-app");
    expect(out.dependencies["@nola-lang/runtime"]).toBe("^0.1.0-alpha.0");
    expect(out.dependencies["@nola-lang/providers"]).toBe("^0.1.0-alpha.0");
    expect(out.devDependencies["nola-lang"]).toBe("^0.1.0-alpha.0");
    expect(out.dependencies["left-pad"]).toBe("^1.0.0");
    expect(out.devDependencies.typescript).toBe("^5.6.0");
  });
});
