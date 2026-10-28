import * as fs from "node:fs";
import { nodeAbsenceReason, nodeBuiltin, processId, readEnv, stderrIsTty, workingDirectory, writeStderr } from "@nola-lang/core";
import { afterEach, describe, expect, it, vi } from "vitest";

describe("nodeAbsenceReason (what a refusal says about where it runs)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("names Node >= 22.3 when process exists but process.getBuiltinModule does not (Node 22.0–22.2)", () => {
    vi.spyOn(process, "getBuiltinModule").mockReturnValue(undefined as never);
    expect(nodeAbsenceReason()).toMatch(/Node >= 22\.3/);
    expect(nodeAbsenceReason()).not.toMatch(/browser/);
  });

  it("names the browser when there is no process at all", () => {
    const saved = globalThis.process;
    Object.defineProperty(globalThis, "process", { value: undefined, configurable: true, writable: true });
    try {
      expect(nodeAbsenceReason()).toMatch(/browser/);
    } finally {
      Object.defineProperty(globalThis, "process", { value: saved, configurable: true, writable: true });
    }
  });
});

describe("host helpers (Node present)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("read the environment, the pid and the working directory from process", () => {
    vi.stubEnv("NOLA_HOST_TEST", "yes");
    expect(readEnv("NOLA_HOST_TEST")).toBe("yes");
    expect(readEnv("NOLA_HOST_TEST_MISSING")).toBeUndefined();
    expect(processId()).toBe(process.pid);
    expect(workingDirectory()).toBe(process.cwd());
    expect(typeof stderrIsTty()).toBe("boolean");
  });

  it("hands out a Node builtin through process.getBuiltinModule", () => {
    expect(nodeBuiltin<typeof fs>("node:fs")?.readFileSync).toBe(fs.readFileSync);
  });

  it("writes to process.stderr", () => {
    const write = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    writeStderr("hello\n");
    expect(write).toHaveBeenCalledWith("hello\n");
  });
});

describe("host helpers (Node absent)", () => {
  // The helpers read `globalThis.process` on every call, so hiding it is the browser.
  const hidden = () => {
    const saved = globalThis.process;
    Object.defineProperty(globalThis, "process", { value: undefined, configurable: true, writable: true });
    return () => Object.defineProperty(globalThis, "process", { value: saved, configurable: true, writable: true });
  };

  it("answer undefined / 0 / false, and stderr falls back to console.error", () => {
    const restore = hidden();
    try {
      expect(readEnv("PATH")).toBeUndefined();
      expect(processId()).toBe(0);
      expect(workingDirectory()).toBeUndefined();
      expect(nodeBuiltin("node:fs")).toBeUndefined();
      expect(stderrIsTty()).toBe(false);
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      writeStderr("line\n");
      expect(error).toHaveBeenCalledWith("line");
    } finally {
      restore();
      vi.restoreAllMocks();
    }
  });
});
