import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CHECKOUT_LINKED_PACKAGES, checkoutRoot, linkCheckoutFromEnv, linkCheckoutPackages } from "../src/checkout.js";

const tmp = () => mkdtemp(join(tmpdir(), "nola-checkout-"));

describe("checkoutRoot", () => {
  it("is the nola-monorepo root when running from the dev checkout", async () => {
    const root = await checkoutRoot();
    expect(root).not.toBeNull();
    const pkg = JSON.parse(await readFile(join(root as string, "package.json"), "utf8"));
    expect(pkg.name).toBe("nola-monorepo");
    expect(existsSync(join(root as string, "packages", "runtime", "package.json"))).toBe(true);
  });
});

describe("linkCheckoutPackages", () => {
  it("points the scaffold's runtime, providers and nola-lang at the workspace packages", async () => {
    const dir = join(await tmp(), "app");
    await mkdir(dir, { recursive: true });
    const root = (await checkoutRoot()) as string;
    const linked = await linkCheckoutPackages(dir, root);
    expect(linked).toEqual(["@nola-lang/runtime", "@nola-lang/providers", "nola-lang"]);
    expect(CHECKOUT_LINKED_PACKAGES).toEqual(linked);
    for (const [name, pkg] of [
      ["@nola-lang/runtime", "runtime"],
      ["@nola-lang/providers", "providers"],
      ["nola-lang", "nola-lang"],
    ]) {
      expect(await realpath(join(dir, "node_modules", name))).toBe(await realpath(join(root, "packages", pkg)));
    }
  });

  it("replaces the registry copies npm installed, leaving the workspace untouched", async () => {
    const dir = join(await tmp(), "app");
    const root = (await checkoutRoot()) as string;
    const installed = join(dir, "node_modules", "@nola-lang", "runtime");
    await mkdir(installed, { recursive: true });
    await writeFile(join(installed, "package.json"), '{"name":"@nola-lang/runtime","version":"0.0.0-registry"}');
    await linkCheckoutPackages(dir, root);
    // linking twice must not recurse into the workspace through the junction
    await linkCheckoutPackages(dir, root);
    const pkg = JSON.parse(await readFile(join(installed, "package.json"), "utf8"));
    expect(pkg.version).not.toBe("0.0.0-registry");
    expect(existsSync(join(root, "packages", "runtime", "src", "index.ts"))).toBe(true);
    expect(existsSync(join(root, "packages", "runtime", "package.json"))).toBe(true);
  });
});

describe("linkCheckoutFromEnv", () => {
  it("is the NOLA_LINK_CHECKOUT path, and null when unset or blank", () => {
    expect(linkCheckoutFromEnv({ NOLA_LINK_CHECKOUT: "  /home/me/nola  " })).toBe("/home/me/nola");
    expect(linkCheckoutFromEnv({})).toBeNull();
    expect(linkCheckoutFromEnv({ NOLA_LINK_CHECKOUT: "  " })).toBeNull();
  });
});
