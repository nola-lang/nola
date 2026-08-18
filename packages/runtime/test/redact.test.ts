import { redactError, redactSecrets } from "@nola-lang/runtime";
import { describe, expect, it } from "vitest";

describe("redactSecrets", () => {
  it("scrubs sk-family keys", () => {
    const out = redactSecrets("failed with key sk-proj-AbCd1234EfGh5678IjKl and more");
    expect(out).not.toMatch(/AbCd1234/);
    expect(out).toContain("[redacted]");
    expect(out).toContain("failed with key");
  });

  it("scrubs bearer/authorization values", () => {
    expect(redactSecrets("authorization: Bearer abc.def.ghi")).toBe("authorization: Bearer [redacted]");
  });

  it("scrubs Google-style AIza keys", () => {
    expect(redactSecrets("key=AIzaSyA1B2C3D4E5F6G7H8I9J0K1L2M3N4O5P6Q")).toContain("[redacted]");
  });

  it("scrubs long hex blobs but leaves short hex alone", () => {
    expect(redactSecrets(`token ${"a".repeat(40)}`)).toContain("[redacted]");
    expect(redactSecrets("status deadbeef")).toBe("status deadbeef");
  });

  it("leaves ordinary text untouched", () => {
    expect(redactSecrets("Intent resolution failed at x.tsi:3:7 — expected string")).toBe(
      "Intent resolution failed at x.tsi:3:7 — expected string",
    );
  });
});

describe("redactError", () => {
  it("renders an Error message, redacted", () => {
    expect(redactError(new Error("bad key sk-proj-AbCd1234EfGh5678IjKl"))).toContain("[redacted]");
  });

  it("stringifies non-Errors", () => {
    expect(redactError("plain")).toBe("plain");
    expect(redactError(42)).toBe("42");
  });
});
