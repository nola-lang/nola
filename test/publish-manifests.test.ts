import { existsSync, globSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

/**
 * The publish partition (decided 2026-08-10): every workspace package is either
 * on npm or deliberately private. A new package must be classified here before
 * it can ship — this test fails until it is.
 */
const PUBLIC = [
  "create-nola",
  "create-nola-lang",
  "nola-lang",
  "@nola-lang/ast",
  "@nola-lang/compiler",
  "@nola-lang/core",
  "@nola-lang/esbuild",
  "@nola-lang/language-core",
  "@nola-lang/language-server",
  "@nola-lang/next",
  "@nola-lang/node-loader",
  "@nola-lang/parser",
  "@nola-lang/providers",
  "@nola-lang/rolldown",
  "@nola-lang/rollup",
  "@nola-lang/rspack",
  "@nola-lang/runtime",
  "@nola-lang/typescript-plugin",
  "@nola-lang/unplugin",
  "@nola-lang/vite",
  "@nola-lang/webpack",
];

/** babel-parser: vendoring policy (bundled into parser); nola-vscode: Marketplace, not npm. */
const PRIVATE = ["@nola-lang/babel-parser", "nola-vscode"];

interface Manifest {
  name: string;
  version: string;
  private?: boolean;
  publishConfig?: { access?: string };
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  description?: string;
  license?: string;
  repository?: { type?: string; url?: string; directory?: string };
  icon?: string;
  categories?: string[];
}

interface Located extends Manifest {
  /** repo-relative dir holding this manifest, posix separators */
  dir: string;
}

function manifests(pattern: string): Located[] {
  return globSync(pattern, { cwd: ROOT }).map((p) => {
    const posix = p.replaceAll("\\", "/");
    return {
      ...(JSON.parse(readFileSync(join(ROOT, p), "utf8")) as Manifest),
      dir: posix.slice(0, posix.lastIndexOf("/")),
    };
  });
}

describe("publish partition", () => {
  const packages = manifests("packages/*/package.json");

  it("covers every workspace package", () => {
    expect(packages.map((m) => m.name).sort()).toEqual([...PUBLIC, ...PRIVATE].sort());
  });

  it.each(PUBLIC)("%s is publishable", (name) => {
    const m = packages.find((p) => p.name === name);
    expect(m?.private).toBeUndefined();
    // Scoped packages default to restricted on npm — public access must be explicit.
    expect(m?.publishConfig?.access).toBe("public");
  });

  it.each(PRIVATE)("%s stays private", (name) => {
    expect(packages.find((p) => p.name === name)?.private).toBe(true);
  });

  it("examples stay private", () => {
    const examples = manifests("examples/*/package.json");
    expect(examples.length).toBeGreaterThan(0);
    for (const m of examples) expect(m.private, m.name).toBe(true);
  });
});

/**
 * npm-page metadata (decided 2026-08-10; relicensed MIT → Apache-2.0 on
 * 2026-08-15 for the explicit patent grant, §5 contribution terms, and §6
 * trademark reservation): what people see on the
 * first publish. Every PUBLIC package carries the fields npm renders and the
 * files its tarball must ship (README; LICENSE — npm auto-includes it even
 * outside `files`).
 */
describe("publish metadata", () => {
  const packages = manifests("packages/*/package.json").filter((m) => PUBLIC.includes(m.name));

  it.each(packages.map((m) => [m.name, m] as const))("%s carries the npm-page fields", (_name, m) => {
    expect(m.description, "description").toBeTruthy();
    expect(m.license).toBe("Apache-2.0");
    expect(m.repository?.type).toBe("git");
    expect(m.repository?.url).toBe("git+https://github.com/nola-lang/nola.git");
    expect(m.repository?.directory).toBe(m.dir);
  });

  it.each(packages.map((m) => [m.name, m] as const))("%s ships README and LICENSE", (_name, m) => {
    expect(existsSync(join(ROOT, m.dir, "README.md")), "README.md").toBe(true);
    const license = readFileSync(join(ROOT, m.dir, "LICENSE"), "utf8");
    expect(license, "LICENSE").toContain("Apache License");
  });

  it("the vendored babel-parser keeps upstream's MIT license text", () => {
    // Vendoring + bundling MIT code requires shipping Babel's copyright notice:
    // the vendor dir carries it, and the parser package (whose dist bundles the
    // fork) restates it for its own tarball.
    expect(existsSync(join(ROOT, "packages/babel-parser/LICENSE"))).toBe(true);
    const parserLicense = readFileSync(join(ROOT, "packages/parser/LICENSE"), "utf8");
    expect(parserLicense).toContain("Sebastian McKenzie");
  });
});

/**
 * Lockstep versioning (decided 2026-08-10): every workspace package shares ONE
 * version, and internal refs are EXACT — that is what guarantees npm dedupes
 * to a single @nola-lang/runtime copy (NOLA3002 hazard) and that one version
 * number names one coherent toolchain (the emit contract's promise). Bump with
 * `node scripts/release.mjs <version>` — never by hand.
 *
 * nola-vscode is the one exemption (decided 2026-08-12): the Marketplace
 * rejects prerelease suffixes (plain major.minor.patch only), so the extension
 * carries its own version line. Its internal refs still pin the lockstep
 * version exactly — release.mjs rewrites them but leaves its `version` alone.
 */
const LOCKSTEP_EXEMPT = ["nola-vscode"];

describe("lockstep versioning", () => {
  const packages = manifests("packages/*/package.json");
  const internalNames = new Set(packages.map((m) => m.name));
  const lockstep = packages.filter((m) => !LOCKSTEP_EXEMPT.includes(m.name));

  it("every workspace package shares one version", () => {
    const versions = new Set(lockstep.map((m) => m.version));
    expect([...versions]).toHaveLength(1);
  });

  it.each(packages.map((m) => [m.name, m] as const))("%s pins internal refs exactly", (_name, m) => {
    const version = lockstep[0]?.version;
    for (const section of [m.dependencies ?? {}, m.devDependencies ?? {}]) {
      for (const [dep, range] of Object.entries(section)) {
        if (internalNames.has(dep)) expect(range, `${m.name} → ${dep}`).toBe(version);
      }
    }
  });
});

/**
 * Marketplace manifest (decided 2026-08-12): nola-vscode ships to the VS Code
 * Marketplace as `nola.nola-vscode`, not to npm. This is what its gallery page
 * and VSIX need — the marketplace analog of the npm-page block above.
 */
describe("marketplace manifest (nola-vscode)", () => {
  const m = manifests("packages/vscode/package.json")[0];
  if (!m) throw new Error("packages/vscode/package.json missing");

  it("carries a plain major.minor.patch version (the Marketplace rejects prerelease suffixes)", () => {
    expect(m.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("carries the gallery-page fields", () => {
    expect(m.description, "description").toBeTruthy();
    expect(m.license).toBe("Apache-2.0");
    expect(m.repository?.type).toBe("git");
    expect(m.repository?.url).toBe("git+https://github.com/nola-lang/nola.git");
    expect(m.repository?.directory).toBe("packages/vscode");
    expect(m.categories).toContain("Programming Languages");
  });

  it("declares an icon that exists", () => {
    expect(m.icon).toBe("media/icon.png");
    expect(existsSync(join(ROOT, "packages/vscode", m.icon ?? ""))).toBe(true);
  });

  it("ships README, LICENSE, and CHANGELOG", () => {
    for (const f of ["README.md", "LICENSE", "CHANGELOG.md"]) {
      expect(existsSync(join(ROOT, "packages/vscode", f)), f).toBe(true);
    }
  });
});
