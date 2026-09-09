import { existsSync } from "node:fs";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { scaffold } from "../src/index.js";

const tmp = () => mkdtemp(join(tmpdir(), "nola-scaffold-provider-"));

describe("scaffold and the inference provider", () => {
  it("nola: skips the replay ledger, writes the platform config, renders the trial README notes", async () => {
    const root = join(await tmp(), "trial-app");
    const result = await scaffold(root, { provider: "nola" });
    expect(existsSync(join(root, "nola.replay.jsonl"))).toBe(false);
    expect(result.files).not.toContain("nola.replay.jsonl");
    expect(await readFile(join(root, "nola.config.ts"), "utf8")).toContain("model: nola.infer()");
    const readme = await readFile(join(root, "README.md"), "utf8");
    expect(readme).toContain("uses your 25 free Nola runs (key in .env)");
    expect(readme).toContain("npx nola-lang account");
    expect(readme).not.toContain("platform.nola.sh");
    expect(readme).not.toContain("__START_NOTE__");
    expect(readme).not.toContain("__PROVIDER_NOTE__");
  });

  it.each([
    ["openai", 'openai("gpt-5-mini")', "OPENAI_API_KEY"],
    ["anthropic", 'anthropic("claude-sonnet-4-5")', "ANTHROPIC_API_KEY"],
    ["google", 'google("gemini-2.5-flash")', "GEMINI_API_KEY"],
  ] as const)("%s: skips the ledger, writes that vendor's config, README names the env var", async (provider, model, envVar) => {
    const root = join(await tmp(), `${provider}-app`);
    const result = await scaffold(root, { provider });
    expect(result.files).not.toContain("nola.replay.jsonl");
    const config = await readFile(join(root, "nola.config.ts"), "utf8");
    expect(config).toContain(`model: ${model}`);
    expect(config).toContain(`import { ${provider} } from "@nola-lang/providers"`);
    expect(config).toContain(envVar);
    const readme = await readFile(join(root, "README.md"), "utf8");
    expect(readme).toContain(`set ${envVar} in .env first`);
    expect(readme).toContain(envVar);
    expect(readme).not.toContain("nola.replay.jsonl");
    expect(readme).not.toContain("__PROVIDER_NOTE__");
  });

  it("a vendor config on the empty template replaces its default openai config", async () => {
    const root = join(await tmp(), "empty-anthropic");
    await scaffold(root, { template: "empty", provider: "anthropic" });
    const config = await readFile(join(root, "nola.config.ts"), "utf8");
    expect(config).toContain('model: anthropic("claude-sonnet-4-5")');
    expect(config).not.toContain("openai");
  });

  it("none (the default): keeps the ledger, the template's own config and the offline README notes", async () => {
    const root = join(await tmp(), "offline-app");
    await scaffold(root);
    expect(existsSync(join(root, "nola.replay.jsonl"))).toBe(true);
    expect(await readFile(join(root, "nola.config.ts"), "utf8")).toContain('replay("./nola.replay.jsonl")');
    const readme = await readFile(join(root, "README.md"), "utf8");
    expect(readme).toContain("works offline, no API key needed");
    expect(readme).toContain("nola.replay.jsonl");
    expect(readme).not.toContain("__START_NOTE__");
  });

  it("both builtin .gitignore files list .env and .env.*", async () => {
    for (const template of ["starter", "empty"]) {
      const root = join(await tmp(), template);
      await scaffold(root, { template });
      const ignore = await readFile(join(root, ".gitignore"), "utf8");
      expect(ignore.split("\n")).toEqual(expect.arrayContaining([".env", ".env.*"]));
    }
  });
});
