import { describe, expect, it } from "vitest";
import { ExampleFetchError, type FetchLike, fetchExampleFromGitHub } from "../src/github.js";

const TREE = {
  tree: [
    { path: "examples/extract-resume/package.json", type: "blob" },
    { path: "examples/extract-resume/src", type: "tree" },
    { path: "examples/extract-resume/src/main.ts", type: "blob" },
    { path: "examples/other/file.ts", type: "blob" },
  ],
};

/** URL-substring → response; unmatched URLs 404. */
function stubFetch(routes: Record<string, { status?: number; json?: unknown; text?: string }>): FetchLike {
  return async (url: string) => {
    const hit = Object.entries(routes).find(([key]) => url.includes(key))?.[1];
    const status = hit?.status ?? (hit ? 200 : 404);
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => hit?.json,
      text: async () => hit?.text ?? "",
    };
  };
}

describe("fetchExampleFromGitHub", () => {
  it("fetches an example's files from the version tag", async () => {
    const fetchImpl = stubFetch({
      "git/trees/v0.1.0-alpha.0": { json: TREE },
      "v0.1.0-alpha.0/examples/extract-resume/package.json": { text: '{"name":"x"}' },
      "v0.1.0-alpha.0/examples/extract-resume/src/main.ts": { text: "// main" },
    });
    const files = await fetchExampleFromGitHub("extract-resume", "0.1.0-alpha.0", fetchImpl);
    expect([...files.keys()].sort()).toEqual(["package.json", "src/main.ts"]);
    expect(files.get("src/main.ts")).toBe("// main");
  });

  it("falls back to main when the version tag is missing", async () => {
    const fetchImpl = stubFetch({
      "git/trees/main": { json: TREE },
      "main/examples/extract-resume/package.json": { text: "{}" },
      "main/examples/extract-resume/src/main.ts": { text: "" },
    });
    const files = await fetchExampleFromGitHub("extract-resume", "9.9.9", fetchImpl);
    expect(files.has("package.json")).toBe(true);
  });

  it("reports an example missing from the tree", async () => {
    const fetchImpl = stubFetch({ "git/trees/v0.1.0": { json: TREE } });
    await expect(fetchExampleFromGitHub("no-such", "0.1.0", fetchImpl)).rejects.toThrow(ExampleFetchError);
  });

  it("reports a mid-fetch file failure", async () => {
    const fetchImpl = stubFetch({
      "git/trees/v0.1.0": { json: TREE },
      "v0.1.0/examples/extract-resume/package.json": { text: "{}" },
      // src/main.ts route absent -> 404
    });
    await expect(fetchExampleFromGitHub("extract-resume", "0.1.0", fetchImpl)).rejects.toThrow(ExampleFetchError);
  });

  it("refuses a truncated tree instead of scaffolding a partial project", async () => {
    const fetchImpl = stubFetch({ "git/trees/v0.1.0": { json: { ...TREE, truncated: true } } });
    await expect(fetchExampleFromGitHub("extract-resume", "0.1.0", fetchImpl)).rejects.toThrow(ExampleFetchError);
  });

  it("fails cleanly when GitHub is unreachable entirely", async () => {
    await expect(fetchExampleFromGitHub("extract-resume", "0.1.0", stubFetch({}))).rejects.toThrow(ExampleFetchError);
  });
});
