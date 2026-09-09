import { redactError, redactSecrets } from "@nola-lang/runtime";
import { describe, expect, it } from "vitest";

/** An obviously fake key that still has a real key's shape (nothing key-shaped is committed as a literal). */
const FAKE_KEY = `sk-proj-${"A".repeat(24)}`;

describe("redactSecrets", () => {
  it("scrubs sk-family keys", () => {
    const out = redactSecrets(`failed with key ${FAKE_KEY} and more`);
    expect(out).not.toMatch(/AbCd1234/);
    expect(out).toContain("[redacted]");
    expect(out).toContain("failed with key");
  });

  it("scrubs bearer/authorization values", () => {
    expect(redactSecrets("authorization: Bearer abc.def.ghi")).toBe("authorization: Bearer [redacted]");
  });

  it("scrubs Google-style AIza keys", () => {
    expect(redactSecrets(`key=AIza${"A".repeat(35)}`)).toContain("[redacted]");
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
    expect(redactError(new Error(`bad key ${FAKE_KEY}`))).toContain("[redacted]");
  });

  it("stringifies non-Errors", () => {
    expect(redactError("plain")).toBe("plain");
    expect(redactError(42)).toBe("42");
  });
});
