import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConsoleService, createApp, loadUiAssets, SqliteConsoleStorage } from "@nola-lang/console";
import { describe, expect, it } from "vitest";

const fakeUi = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "nola-ui-"));
  writeFileSync(join(dir, "index.html"), '<!doctype html><title>nola console</title><div id="root"></div>');
  writeFileSync(join(dir, "nola.svg"), "<svg/>");
  mkdirSync(join(dir, "assets"));
  writeFileSync(join(dir, "assets", "app.js"), "console.log(1)");
  writeFileSync(join(dir, "assets", "app.css"), "body{}");
  return dir;
};

describe("loadUiAssets", () => {
  it("maps index.html and assets with content types; undefined without index.html", () => {
    const assets = loadUiAssets(fakeUi());
    expect(assets?.get("/")?.type).toContain("text/html");
    expect(assets?.get("/assets/app.js")?.type).toContain("javascript");
    expect(assets?.get("/assets/app.css")?.type).toContain("text/css");
    expect(loadUiAssets(mkdtempSync(join(tmpdir(), "nola-empty-")))).toBeUndefined();
    expect(loadUiAssets(join(tmpdir(), "does-not-exist-nola"))).toBeUndefined();
  });
});

describe("createApp with a uiDir", () => {
  it("serves the built UI at / and every bundled file, placeholder otherwise", async () => {
    const service = new ConsoleService(new SqliteConsoleStorage(":memory:"));
    const withUi = createApp(service, { uiDir: fakeUi() });
    expect(await (await withUi.request("/")).text()).toContain('<div id="root">');
    const js = await withUi.request("/assets/app.js");
    expect(js.status).toBe(200);
    expect(js.headers.get("content-type")).toContain("javascript");
    const favicon = await withUi.request("/nola.svg");
    expect(favicon.status).toBe(200);
    expect(favicon.headers.get("content-type")).toContain("image/svg+xml");
    expect((await withUi.request("/assets/nope.js")).status).toBe(404);
    expect((await withUi.request("/nope.svg")).status).toBe(404);

    const withoutUi = createApp(service);
    expect(await (await withoutUi.request("/")).text()).toContain("The trace UI ships in the next release");
  });
});

describe("SPA fallback", () => {
  it("serves index.html for extension-less client routes, 404 for missing files and unknown API paths", async () => {
    const service = new ConsoleService(new SqliteConsoleStorage(":memory:"));
    const app = createApp(service, { uiDir: fakeUi() });
    for (const route of ["/traces", "/traces/abc-123", `/asks/${"e2".repeat(32)}?ask=x`]) {
      const res = await app.request(route);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/html");
      expect(await res.text()).toContain('<div id="root">');
    }
    expect((await app.request("/assets/nope.js")).status).toBe(404);
    expect((await app.request("/api/nope")).status).toBe(404);
    expect((await app.request("/v1/nope")).status).toBe(404);
  });
});
