import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CHECKOUT_DIST_SKIP_GLOB,
  CHECKOUT_LINKED_PACKAGES,
  checkoutRoot,
  linkCheckoutFromEnv,
  linkCheckoutPackages,
  skipCheckoutDistInLaunch,
} from "../src/checkout.js";
import { writeVscodeSetup } from "../src/ide.js";

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

describe("skipCheckoutDistInLaunch", () => {
  // A relinked scaffold resolves the runtime to <checkout>/packages/*/dist —
  // outside node_modules — so the snippet's skipFiles no longer cover Nola's
  // own code and js-debug loses F10 over the first network ask (the step lands
  // on js-debug's WebAssembly pause and is resumed away). The dogfood glob
  // blackboxes it again.
  it("adds the packages/*/dist glob to every configuration's skipFiles", async () => {
    const dir = join(await tmp(), "app");
    await writeVscodeSetup(dir, "src/main.tsi");
    expect(await skipCheckoutDistInLaunch(dir)).toBe(true);
    const launch = JSON.parse(await readFile(join(dir, ".vscode", "launch.json"), "utf8"));
    expect(launch.configurations).toHaveLength(1);
    expect(launch.configurations[0].skipFiles).toEqual(["<node_internals>/**", "**/node_modules/**", CHECKOUT_DIST_SKIP_GLOB]);
    expect(CHECKOUT_DIST_SKIP_GLOB).toBe("**/packages/*/dist/**");
  });

  it("is idempotent and reports nothing to do the second time", async () => {
    const dir = join(await tmp(), "app");
    await writeVscodeSetup(dir, "src/main.tsi");
    await skipCheckoutDistInLaunch(dir);
    const once = await readFile(join(dir, ".vscode", "launch.json"), "utf8");
    expect(await skipCheckoutDistInLaunch(dir)).toBe(false);
    expect(await readFile(join(dir, ".vscode", "launch.json"), "utf8")).toBe(once);
  });

  it("leaves a project without .vscode/launch.json alone", async () => {
    const dir = join(await tmp(), "app");
    await mkdir(dir, { recursive: true });
    expect(await skipCheckoutDistInLaunch(dir)).toBe(false);
    expect(existsSync(join(dir, ".vscode"))).toBe(false);
  });

  it("gives a configuration without skipFiles the glob, and never touches one it cannot parse", async () => {
    const dir = join(await tmp(), "app");
    await mkdir(join(dir, ".vscode"), { recursive: true });
    const path = join(dir, ".vscode", "launch.json");
    await writeFile(path, JSON.stringify({ version: "0.2.0", configurations: [{ type: "node", name: "x" }] }));
    expect(await skipCheckoutDistInLaunch(dir)).toBe(true);
    expect(JSON.parse(await readFile(path, "utf8")).configurations[0].skipFiles).toEqual([CHECKOUT_DIST_SKIP_GLOB]);
    await writeFile(path, "{ // a comment\n}");
    expect(await skipCheckoutDistInLaunch(dir)).toBe(false);
    expect(await readFile(path, "utf8")).toBe("{ // a comment\n}");
  });
});

describe("linkCheckoutFromEnv", () => {
  it("is the NOLA_LINK_CHECKOUT path, and null when unset or blank", () => {
    expect(linkCheckoutFromEnv({ NOLA_LINK_CHECKOUT: "  /home/me/nola  " })).toBe("/home/me/nola");
    expect(linkCheckoutFromEnv({})).toBeNull();
    expect(linkCheckoutFromEnv({ NOLA_LINK_CHECKOUT: "  " })).toBeNull();
  });
});
