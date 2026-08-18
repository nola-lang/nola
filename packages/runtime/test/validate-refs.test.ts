import type { JsonSchema } from "@nola-lang/core";
import { validate } from "@nola-lang/runtime";
import { describe, expect, it } from "vitest";

// self-recursive tree: type Node = { label: string; kids?: Node[] } — the
// shape a recursive InferType serializes to (root $defs + $ref pointers).
const TREE: JsonSchema = {
  $ref: "#/$defs/Node",
  $defs: {
    Node: {
      type: "object",
      properties: {
        label: { type: "string" },
        kids: { type: "array", items: { $ref: "#/$defs/Node" } },
      },
      required: ["label"],
      additionalProperties: false,
    },
  },
};

describe("validate with $defs/$ref", () => {
  it("accepts recursive data", () => {
    const value = { label: "root", kids: [{ label: "leaf" }, { label: "mid", kids: [{ label: "deep" }] }] };
    expect(validate(TREE, value)).toEqual({ ok: true, value });
  });

  it("rejects a violation deep inside the recursion with a path", () => {
    const r = validate(TREE, { label: "root", kids: [{ label: 7 }] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("$.kids[0].label");
  });

  it("fails cleanly on an unknown $ref", () => {
    const r = validate({ $ref: "#/$defs/Missing" }, {});
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("Missing");
  });
});
