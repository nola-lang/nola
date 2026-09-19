import { existsSync } from "node:fs";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { scaffold } from "../src/index.js";
import { envExample, vendorEnvVar } from "../src/scaffold.js";

const tmp = () => mkdtemp(join(tmpdir(), "nola-scaffold-provider-"));

describe("scaffold and the inference provider", () => {
  it("nola: skips the replay ledger, writes the platform config, renders the trial README notes", async () => {
    const root = join(await tmp(), "trial-app");
    const result = await scaffold(root, { provider: "nola" });
    expect(existsSync(join(root, "nola.replay.jsonl"))).toBe(false);
    expect(result.files).not.toContain("nola.replay.jsonl");
    expect(await readFile(join(root, "nola.config.ts"), "utf8")).toContain('model: "nola"');
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
    ["typesafe", "typesafe()", "TYPESAFE_API_KEY"],
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
    expect(readme).toContain(".env.example");
    expect(readme).not.toContain("nola.replay.jsonl");
    expect(readme).not.toContain("__PROVIDER_NOTE__");
    // the key's slot, ready to copy to .env (the .gitignore keeps .env.example trackable)
    expect(result.files).toContain(".env.example");
    expect(await readFile(join(root, ".env.example"), "utf8")).toBe(envExample(envVar));
    expect(envExample(envVar)).toMatch(new RegExp(`^${envVar}=$`, "m"));
    expect(envExample(envVar)).toMatch(/^# .*\.env/m);
  });

  it("a vendor on every builtin template and on an example writes .env.example for that vendor's key", async () => {
    for (const template of ["feature-extraction", "function-calling", "typescript-interop", "empty", "extract-resume"]) {
      const root = join(await tmp(), `${template}-openai`);
      const result = await scaffold(root, { template, provider: "openai" });
      expect(result.files, template).toContain(".env.example");
      expect(await readFile(join(root, ".env.example"), "utf8"), template).toContain("OPENAI_API_KEY=");
    }
  });

  it("a template that pins its vendor (triage-ticket) writes .env.example for TYPESAFE_API_KEY under provider none", async () => {
    const root = join(await tmp(), "triage");
    const result = await scaffold(root, { template: "triage-ticket" });
    expect(result.files).toContain(".env.example");
    expect(await readFile(join(root, ".env.example"), "utf8")).toContain("TYPESAFE_API_KEY=");
    expect(vendorEnvVar("triage-ticket", "none")).toBe("TYPESAFE_API_KEY");
    // an explicit vendor still wins over the pin
    expect(vendorEnvVar("triage-ticket", "openai")).toBe("OPENAI_API_KEY");
  });

  it("nola and none write no .env.example: the trial key lands in .env itself, and offline needs no key", async () => {
    for (const [template, provider] of [
      ["feature-extraction", "nola"],
      ["feature-extraction", "none"],
      ["empty", "none"],
      ["extract-resume", "none"],
    ] as const) {
      const root = join(await tmp(), `${template}-${provider}`);
      const result = await scaffold(root, { template, provider });
      expect(result.files, `${template}/${provider}`).not.toContain(".env.example");
      expect(existsSync(join(root, ".env.example")), `${template}/${provider}`).toBe(false);
    }
    expect(vendorEnvVar("feature-extraction", "nola")).toBeUndefined();
    expect(vendorEnvVar("feature-extraction", "none")).toBeUndefined();
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
    for (const template of ["typescript-interop", "empty"]) {
      const root = join(await tmp(), template);
      await scaffold(root, { template });
      const ignore = await readFile(join(root, ".gitignore"), "utf8");
      expect(ignore.split("\n")).toEqual(expect.arrayContaining([".env", ".env.*"]));
    }
  });
});
