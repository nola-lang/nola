import { describe, expect, it } from "vitest";
import { withNola } from "../src/index.js";

type WebpackConfigLike = {
  module: { rules: unknown[] };
  resolve: { extensionAlias?: Record<string, string[]> };
  plugins: unknown[];
};
type WebpackFn = (config: WebpackConfigLike, ctx: { isServer: boolean }) => WebpackConfigLike;

function baseWebpackConfig(): WebpackConfigLike {
  return { module: { rules: [] }, resolve: {}, plugins: [] };
}

describe("withNola", () => {
  it("adds the turbopack rule, serverExternalPackages, and preserves user config", () => {
    const cfg = withNola({ reactStrictMode: true, serverExternalPackages: ["sharp"] });
    expect(cfg.reactStrictMode).toBe(true);
    expect(cfg.serverExternalPackages).toEqual(["sharp", "@nola-lang/runtime"]);
    const rules = (cfg.turbopack as { rules: Record<string, unknown> }).rules;
    expect(rules["*.tsi"]).toMatchObject({ as: "*.js" });
    const loaders = (rules["*.tsi"] as { loaders: string[] }).loaders;
    expect(loaders[0]).toMatch(/turbopack-loader\.cjs$/);
  });

  it("webpack(): server compilation gets the nola plugin; client gets the error loader", () => {
    const cfg = withNola({});
    const webpack = cfg.webpack as WebpackFn;
    const server = webpack(baseWebpackConfig(), { isServer: true });
    expect(server.plugins.length).toBeGreaterThan(0);
    expect(server.resolve.extensionAlias).toEqual({ ".js": [".js", ".ts"] });
    const client = webpack(baseWebpackConfig(), { isServer: false });
    expect(JSON.stringify(client.module.rules)).toContain("client-error-loader");
  });

  it("chains a user webpack function after ours", () => {
    let sawIt = false;
    const cfg = withNola({
      webpack: (c: unknown) => {
        sawIt = true;
        return c;
      },
    });
    (cfg.webpack as WebpackFn)(baseWebpackConfig(), { isServer: true });
    expect(sawIt).toBe(true);
  });
});
