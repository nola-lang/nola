import { describe, expect, it } from "vitest";
import { detectPackageManager, packageManagerCommands } from "../src/package-manager.js";

describe("detectPackageManager", () => {
  it("reads the invoking manager from npm_config_user_agent", () => {
    expect(detectPackageManager("npm/10.9.4 node/v22.21.1 win32 x64 workspaces/false")).toBe("npm");
    expect(detectPackageManager("pnpm/10.23.0 npm/? node/v22.21.1 win32 x64")).toBe("pnpm");
    expect(detectPackageManager("yarn/1.22.22 npm/? node/v22.21.1 win32 x64")).toBe("yarn");
    expect(detectPackageManager("yarn/4.18.0 npm/? node/v22.21.1 win32 x64")).toBe("yarn");
    expect(detectPackageManager("bun/1.3.14 npm/? node/v24.3.0 win32 x64")).toBe("bun");
  });

  it("defaults to npm when the agent is missing or unknown", () => {
    expect(detectPackageManager(undefined)).toBe("npm");
    expect(detectPackageManager("")).toBe("npm");
    expect(detectPackageManager("deno/2.0.0")).toBe("npm");
  });
});

describe("packageManagerCommands", () => {
  it("spells install/start/run per manager", () => {
    expect(packageManagerCommands("npm")).toEqual({ install: "npm install", start: "npm start", run: "npm run" });
    expect(packageManagerCommands("pnpm")).toEqual({ install: "pnpm install", start: "pnpm start", run: "pnpm run" });
    expect(packageManagerCommands("yarn")).toEqual({ install: "yarn install", start: "yarn start", run: "yarn run" });
    expect(packageManagerCommands("bun")).toEqual({ install: "bun install", start: "bun start", run: "bun run" });
  });
});
