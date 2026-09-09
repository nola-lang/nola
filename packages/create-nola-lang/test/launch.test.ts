import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { describe, expect, it } from "vitest";
import { findOnPath, installArgs } from "../src/launch.js";

const tmp = () => mkdtemp(join(tmpdir(), "nola-launch-"));

describe("findOnPath", () => {
  // A posix PATH cannot hold a Windows path (the drive colon is the separator),
  // so the posix split is only checked on posix hosts; the host-platform case
  // below runs everywhere.
  it.skipIf(process.platform === "win32")("finds a bare executable on a posix PATH", async () => {
    const dir = await tmp();
    await writeFile(join(dir, "code"), "#!/bin/sh\n");
    expect(findOnPath("code", { PATH: `/nowhere:${dir}` }, "linux")).toBe(join(dir, "code"));
  });

  it("finds the executable through the host platform's PATH conventions", async () => {
    const dir = await tmp();
    const file = process.platform === "win32" ? "code.cmd" : "code";
    await writeFile(join(dir, file), "");
    const env = { PATH: [join(dir, "nowhere"), dir].join(delimiter), PATHEXT: ".COM;.EXE;.BAT;.CMD" };
    expect(findOnPath("code", env, process.platform)).toBe(join(dir, file));
  });

  it("on Windows resolves through PATHEXT (code.cmd) and never the bare POSIX shim", async () => {
    const dir = await tmp();
    // VS Code's bin dir holds both: `code` (a sh script cmd.exe cannot run) and `code.cmd`
    await writeFile(join(dir, "code"), "#!/usr/bin/env sh\n");
    await writeFile(join(dir, "code.cmd"), "@echo off\n");
    expect(findOnPath("code", { Path: `C:\\nowhere;${dir}`, PATHEXT: ".COM;.EXE;.BAT;.CMD" }, "win32")).toBe(
      join(dir, "code.cmd"),
    );
    const bareOnly = await tmp();
    await writeFile(join(bareOnly, "code"), "#!/usr/bin/env sh\n");
    expect(findOnPath("code", { Path: bareOnly, PATHEXT: ".COM;.EXE;.BAT;.CMD" }, "win32")).toBeUndefined();
  });

  it("returns undefined when nothing matches", async () => {
    const dir = await tmp();
    expect(findOnPath("code", { PATH: dir }, "linux")).toBeUndefined();
    expect(findOnPath("code", {}, "linux")).toBeUndefined();
  });
});

describe("installArgs", () => {
  // npm audits on every install with a POST to the registry advisory endpoint;
  // on networks that drop that request the scaffold sat on a spinner for
  // minutes with nothing to show (reproduced 2026-09-03: 190 s, install
  // itself 1 s). The scaffold gains nothing from the audit or the funding
  // notice, so npm runs without them; the other managers have no such step.
  it("npm skips the audit and the funding notice", () => {
    expect(installArgs("npm")).toEqual(["install", "--no-audit", "--no-fund"]);
  });

  it("pnpm, yarn and bun run a plain install", () => {
    expect(installArgs("pnpm")).toEqual(["install"]);
    expect(installArgs("yarn")).toEqual(["install"]);
    expect(installArgs("bun")).toEqual(["install"]);
  });
});
