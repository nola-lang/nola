import { formatIssue, formatIssuePath, formatIssues, NolaValidationError } from "@nola-lang/core";
import { describe, expect, it } from "vitest";

describe("validation issues", () => {
  it("renders paths the way the validator always did", () => {
    expect(formatIssuePath([])).toBe("$");
    expect(formatIssuePath(["geo", "lat"])).toBe("$.geo.lat");
    expect(formatIssuePath(["kids", 0, "label"])).toBe("$.kids[0].label");
  });

  it("formats one issue as `<path>: <message>` and joins many with '; '", () => {
    expect(formatIssue({ path: ["a"], message: "expected string, got number" })).toBe("$.a: expected string, got number");
    expect(
      formatIssues([
        { path: [], message: "m1" },
        { path: ["x", 1], message: "m2" },
      ]),
    ).toBe("$: m1; $.x[1]: m2");
  });

  it("NolaValidationError carries code and issues", () => {
    const issues = [{ path: ["id"], message: "missing required property 'id'" }];
    const err = new NolaValidationError("NOLA3016: nope", "NOLA3016", issues);
    expect(err.name).toBe("NolaValidationError");
    expect(err.code).toBe("NOLA3016");
    expect(err.issues).toBe(issues);
    expect(err.message).toBe("NOLA3016: nope");
  });
});
