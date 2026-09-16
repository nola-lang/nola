import { inferTypes as t } from "@nola-lang/runtime";
import { describe, expect, it } from "vitest";
import { validateCarrier } from "../src/types/validate-carrier.js";

const user = t.object({
  id: t.string(),
  age: t.number(),
  tags: t.array(t.enum(["a", "b"])),
  at: t.optional(t.date()),
});

describe("validateCarrier", () => {
  it("collects EVERY issue in one pass", () => {
    const r = validateCarrier(user, { id: 7, tags: ["a", "zz", 3], extra: 1 });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.issues.map((i) => `${i.path.join(".")}: ${i.message}`)).toEqual([
      ": missing required property 'age'",
      "id: expected string, got number",
      'tags.1: expected one of "a", "b", got "zz"',
      "tags.2: expected string, got number",
      ": unknown property 'extra'",
    ]);
  });

  it("revives in the same pass", () => {
    const r = validateCarrier(user, { id: "x", age: 1, tags: [], at: "2026-01-02T03:04:05.000Z" });
    expect(r.ok && (r.value as { at: Date }).at instanceof Date).toBe(true);
  });

  it("resolves refs and cycles", () => {
    const node: ReturnType<typeof t.ref> = t.ref("Node", () =>
      t.object({ label: t.string(), kids: t.optional(t.array(node)) }),
    );
    expect(validateCarrier(node, { label: "a", kids: [{ label: 1 }] })).toEqual({
      ok: false,
      issues: [{ path: ["kids", 0, "label"], message: "expected string, got number" }],
    });
  });

  it("InferType.validate and parse use it (every issue, revived value)", () => {
    const r = user.validate({ id: 1, age: "x", tags: [] });
    expect(!r.ok && r.issues.length).toBe(2);
    expect(() => user.parse({ id: 1, age: "x", tags: [] })).toThrow(/NOLA3016.*id: expected string.*age: expected finite number/s);
  });
});
