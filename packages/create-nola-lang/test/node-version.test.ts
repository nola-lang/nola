import { describe, expect, it } from "vitest";
import { NODE_FLOOR, nodeSupportsTypeStripping, nodeVersionWarning } from "../src/node-version.js";

describe("nodeSupportsTypeStripping", () => {
  it("is true from 22.18 on the 22 line, 23.6 on the 23 line, and every later major", () => {
    for (const v of ["22.18.0", "22.21.1", "23.6.0", "23.11.0", "24.0.0", "25.1.0"]) {
      expect(nodeSupportsTypeStripping(v), v).toBe(true);
    }
  });

  it("is false before those releases (native stripping still behind a flag) and before Node 22", () => {
    for (const v of ["22.6.0", "22.12.0", "22.17.1", "23.0.0", "23.5.0", "20.19.0", "18.20.0"]) {
      expect(nodeSupportsTypeStripping(v), v).toBe(false);
    }
  });

  it("names the documented floor", () => {
    expect(NODE_FLOOR).toBe("22.18");
  });
});

describe("nodeVersionWarning", () => {
  it("is silent on a supported Node", () => {
    expect(nodeVersionWarning("22.18.0")).toBeUndefined();
    expect(nodeVersionWarning("24.3.0")).toBeUndefined();
  });

  it("names the running version, the floor, the symptom, and both remedies on 22.6–22.17", () => {
    const w = nodeVersionWarning("22.6.0");
    expect(w).toContain("Node 22.6.0");
    expect(w).toContain("Node >= 22.18");
    expect(w).toContain("ERR_UNKNOWN_FILE_EXTENSION");
    expect(w).toContain("Upgrade Node");
    expect(w).toContain("--experimental-strip-types");
    expect(w).toContain(".vscode/launch.json");
  });

  it("offers only the upgrade before Node 22.6, where the flag does not exist", () => {
    const w = nodeVersionWarning("20.19.0");
    expect(w).toContain("Node 20.19.0");
    expect(w).toContain("Upgrade Node");
    expect(w).not.toContain("--experimental-strip-types");
  });

  it("reads process.versions.node by default", () => {
    expect(nodeVersionWarning()).toBe(nodeVersionWarning(process.versions.node));
  });
});
