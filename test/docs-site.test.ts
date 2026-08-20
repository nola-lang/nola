import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../docs-site", import.meta.url));

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });

/** every file under docs-site/, posix-relative, minus the contract README */
const files = walk(ROOT)
  .map((p) => relative(ROOT, p).split("\\").join("/"))
  .filter((p) => p !== "README.md")
  .sort();

/** the pages proper — assets are files too, but carry no frontmatter or links */
const pages = files.filter((p) => /\.mdx?$/.test(p));

const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

/** 'language/ask.mdx' -> '/docs/language/ask/';  'index.mdx' -> '/docs/' */
const routeOf = (page: string) => {
  const segments = page
    .replace(/\.mdx?$/, "")
    .split("/")
    .filter(Boolean);
  if (segments[segments.length - 1] === "index") segments.pop();
  return `/docs/${segments.join("/")}${segments.length > 0 ? "/" : ""}`;
};
const routes = new Set(pages.map(routeOf));

/** drop fenced code blocks — samples contain imports and paths that are not page content */
const stripFences = (text: string) => {
  const out: string[] = [];
  let inFence = false;
  for (const line of text.split("\n")) {
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (!inFence) out.push(line);
  }
  return out.join("\n");
};

const frontmatter = (text: string) => /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(text)?.[1] ?? null;
const topLevelKeys = (fm: string) =>
  fm
    .split("\n")
    .map((line) => /^([a-z][\w-]*):/.exec(line)?.[1])
    .filter((k): k is string => Boolean(k))
    .sort();

const LINK = /\]\(([^)\s]+)\)/g;
const IMPORT = /^import\s+[^'"]*from\s+['"]([^'"]+)['"]/gm;

/**
 * The sidebar groups, in reading order. The website owns the labels and order
 * (packages/nola-web/src/lib/docs-groups.ts) and builds its sidebar from these
 * directory names; a page under any other top-level directory would sync fine
 * and then be silently absent from the sidebar. URL contract: /docs/<dir>/<page>/.
 */
const GROUP_DIRS = [
  "start",
  "language",
  "config",
  "guides",
  "tooling",
  "reference",
  "internals",
  "compare",
  "examples",
  "project",
];

describe("docs-site contract", () => {
  it("has the full page set", () => {
    expect(pages.length).toBeGreaterThan(40);
  });

  it("keeps every page in a sidebar group directory (or the root index)", () => {
    const stray = pages.filter((p) => p !== "index.mdx" && !GROUP_DIRS.includes(p.split("/")[0] as string));
    expect(stray).toEqual([]);
  });

  it("contains only pages and assets", () => {
    expect(files.filter((p) => !/\.mdx?$/.test(p) && !p.startsWith("assets/"))).toEqual([]);
  });

  it.each(pages)("%s has exactly title, description, sidebar", (page) => {
    const fm = frontmatter(read(page));
    expect(fm, `${page}: no frontmatter block`).not.toBeNull();
    expect(topLevelKeys(fm as string)).toEqual(["description", "sidebar", "title"]);
  });

  it.each(pages)("%s has a 50-160 char description", (page) => {
    const fm = frontmatter(read(page)) as string;
    const value =
      /^description:\s*(.*)$/m
        .exec(fm)?.[1]
        ?.trim()
        .replace(/^["']|["']$/g, "") ?? "";
    expect(value.length, `${page}: description is ${value.length} chars`).toBeGreaterThanOrEqual(50);
    expect(value.length, `${page}: description is ${value.length} chars`).toBeLessThanOrEqual(160);
  });

  it.each(pages)("%s declares sidebar.order", (page) => {
    expect(frontmatter(read(page)) as string).toMatch(/^\s+order:\s*-?\d+\s*$/m);
  });

  it.each(pages)("%s links only to pages that exist", (page) => {
    const broken: string[] = [];
    for (const [, target] of stripFences(read(page)).matchAll(LINK)) {
      if (!target.startsWith("/docs/")) continue;
      const path = (target.split("#")[0] as string) || "/docs/";
      if (!routes.has(path.endsWith("/") ? path : `${path}/`)) broken.push(target);
    }
    expect(broken).toEqual([]);
  });

  it.each(pages)("%s does not reference the withheld internal docs tree", (page) => {
    expect(stripFences(read(page))).not.toMatch(/docs\/superpowers/);
  });

  it.each(pages)("%s imports components only from starlight", (page) => {
    const foreign = [...stripFences(read(page)).matchAll(IMPORT)]
      .map(([, specifier]) => specifier)
      .filter((specifier) => specifier !== "@astrojs/starlight/components");
    expect(foreign).toEqual([]);
  });
});
