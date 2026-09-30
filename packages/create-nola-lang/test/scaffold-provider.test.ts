import { existsSync } from "node:fs";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { scaffold } from "../src/index.js";
import { featuredNames } from "../src/registry.js";
import { envExample, providerConfigUrl, vendorEnvVar } from "../src/scaffold.js";

const tmp = () => mkdtemp(join(tmpdir(), "nola-scaffold-provider-"));

describe("scaffold and the inference provider", () => {
  it("nola: skips the replay ledger and writes the platform config; the README is the example's own, the provider story is the config's comment", async () => {
    const root = join(await tmp(), "trial-app");
    const result = await scaffold(root, { provider: "nola" });
    expect(existsSync(join(root, "nola.replay.jsonl"))).toBe(false);
    expect(result.files).not.toContain("nola.replay.jsonl");
    const config = await readFile(join(root, "nola.config.ts"), "utf8");
    expect(config).toContain('model: "nola"');
    expect(config).toContain("npx nola-lang account");
    expect(config).not.toContain("platform.nola.sh");
    const readme = await readFile(join(root, "README.md"), "utf8");
    expect(readme).toMatch(/^# feature-extraction/);
    expect(readme).not.toContain("__");
  });

  it.each([
    ["openai", 'openai("gpt-5-mini")', "OPENAI_API_KEY"],
    ["anthropic", 'anthropic("claude-sonnet-4-5")', "ANTHROPIC_API_KEY"],
    ["google", 'google("gemini-2.5-flash")', "GEMINI_API_KEY"],
    ["typesafe", "typesafe()", "TYPESAFE_API_KEY"],
  ] as const)("%s: skips the ledger, writes that vendor's config naming the env var, and the key's .env.example slot", async (provider, model, envVar) => {
    const root = join(await tmp(), `${provider}-app`);
    const result = await scaffold(root, { provider });
    expect(result.files).not.toContain("nola.replay.jsonl");
    const config = await readFile(join(root, "nola.config.ts"), "utf8");
    expect(config).toContain(`model: ${model}`);
    expect(config).toContain(`import { ${provider} } from "@nola-lang/providers"`);
    expect(config).toContain(envVar);
    // the key's slot, ready to copy to .env (the .gitignore keeps .env.example trackable)
    expect(result.files).toContain(".env.example");
    expect(await readFile(join(root, ".env.example"), "utf8")).toBe(envExample(envVar));
    expect(envExample(envVar)).toMatch(new RegExp(`^${envVar}=$`, "m"));
    expect(envExample(envVar)).toMatch(/^# .*\.env/m);
  });

  it("a vendor on every first-menu template and on an example writes that vendor's config and .env.example — examples included, their own config gives way", async () => {
    for (const template of [...featuredNames(), "extract-resume"]) {
      const root = join(await tmp(), `${template}-openai`);
      const result = await scaffold(root, { template, provider: "openai" });
      expect(result.files, template).toContain(".env.example");
      expect(await readFile(join(root, ".env.example"), "utf8"), template).toContain("OPENAI_API_KEY=");
      // the vendor's config verbatim — never the example's own (a ledger, a mock, typesafe())
      expect(await readFile(join(root, "nola.config.ts"), "utf8"), template).toBe(await readFile(providerConfigUrl("openai"), "utf8"));
      expect(result.files, template).not.toContain("nola.replay.jsonl");
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

  it("none (the default): keeps the ledger and the template's own config", async () => {
    const root = join(await tmp(), "offline-app");
    await scaffold(root);
    expect(existsSync(join(root, "nola.replay.jsonl"))).toBe(true);
    expect(await readFile(join(root, "nola.config.ts"), "utf8")).toContain('replay("./nola.replay.jsonl")');
    const readme = await readFile(join(root, "README.md"), "utf8");
    expect(readme).toContain("nola.replay.jsonl");
    expect(readme).toContain("no API key");
  });

  it("the scaffold's .gitignore lists .env and .env.* for an example and for empty alike", async () => {
    for (const template of ["typescript-interop", "empty"]) {
      const root = join(await tmp(), template);
      await scaffold(root, { template });
      const ignore = await readFile(join(root, ".gitignore"), "utf8");
      expect(ignore.split("\n")).toEqual(expect.arrayContaining([".env", ".env.*"]));
    }
  });
});
