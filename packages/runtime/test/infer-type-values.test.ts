import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { type InferType, NolaValidationError, type StandardSchemaV1, inferTypes as t } from "@nola-lang/runtime";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const user = t.object({
  id: t.string(),
  role: t.enum(["admin", "member"]),
  tags: t.optional(t.array(t.string())),
  since: t.date(),
});

describe("InferType as a value", () => {
  it("validate: accepts and REVIVES (date strings become Date)", () => {
    const r = user.validate({ id: "u1", role: "admin", since: "2026-09-14T00:00:00Z" });
    expect(r.ok).toBe(true);
    if (r.ok) expect((r.value as { since: Date }).since).toBeInstanceOf(Date);
  });

  it("validate: rejects with a structured path", () => {
    const r = user.validate({ id: "u1", role: "owner", since: "2026-09-14T00:00:00Z" });
    expect(r).toEqual({
      ok: false,
      issues: [{ path: ["role"], message: 'expected one of "admin", "member", got "owner"' }],
    });
  });

  it.each([
    [t.string(), "x", 1],
    [t.number(), 2, "2"],
    [t.boolean(), true, "true"],
    [t.array(t.number()), [1], ["1"]],
    // a bare optional carries its inner wire schema (optionality lives in the enclosing object's `required`)
    [t.optional(t.string()), "x", 5],
  ])("every node kind validates (%#)", (type, good, bad) => {
    expect((type as InferType<unknown>).validate(good).ok).toBe(true);
    expect((type as InferType<unknown>).validate(bad).ok).toBe(false);
  });

  it("optional inside an object: absent is fine, null is not", () => {
    const shape = t.object({ note: t.optional(t.string()) });
    expect(shape.validate({}).ok).toBe(true);
    expect(shape.validate({ note: null }).ok).toBe(false);
  });

  it("cyclic refs validate through $defs", () => {
    const node: InferType<unknown> = t.ref("Node", () =>
      t.object({ label: t.string(), kids: t.optional(t.array(node)) }),
    );
    expect(node.validate({ label: "a", kids: [{ label: "b" }] }).ok).toBe(true);
    const bad = node.validate({ label: "a", kids: [{ label: 1 }] });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.issues[0]?.path).toEqual(["kids", 0, "label"]);
  });

  it("ref resolvers may return an accessor FUNCTION (Turbopack inline mode)", () => {
    const viaFn = t.ref("Point", () => () => t.object({ x: t.number() }));
    expect(viaFn.toJsonSchema()).toEqual(t.object({ x: t.number() }).toJsonSchema());
    expect(viaFn.validate({ x: 1 }).ok).toBe(true);
  });

  it("parse returns the revived value or throws NolaValidationError (NOLA3016) with issues", () => {
    const ok = user.parse({ id: "u1", role: "member", since: "2026-09-14T00:00:00Z" }) as { since: Date };
    expect(ok.since).toBeInstanceOf(Date);
    let caught: unknown;
    try {
      user.parse({ id: 7, role: "admin", since: "2026-09-14T00:00:00Z" });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(NolaValidationError);
    const err = caught as NolaValidationError;
    expect(err.code).toBe("NOLA3016");
    expect(err.message).toMatch(/^NOLA3016: value does not match/);
    expect(err.message).toContain("$.id: expected string, got number");
    expect(err.issues).toEqual([{ path: ["id"], message: "expected string, got number" }]);
  });

  it("parse redacts secrets that leak into the message", () => {
    const key = "sk-live-0123456789abcdef0123456789abcdef";
    let message = "";
    try {
      t.enum(["a"]).parse(key);
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).not.toContain(key);
  });

  it("unsupported types throw NOLA3009 from validate too", () => {
    const weird = t.unsupported("no") as unknown as InferType<unknown>;
    expect(() => weird.validate({})).toThrow(/NOLA3009/);
  });

  it("~standard: Standard Schema v1", () => {
    const std: StandardSchemaV1<unknown, unknown> = user;
    const props = std["~standard"];
    expect(props.version).toBe(1);
    expect(props.vendor).toBe("nola");
    expect(props.validate({ id: "u1", role: "admin", since: "2026-09-14T00:00:00Z" })).toMatchObject({
      value: expect.anything(),
    });
    const failed = props.validate({ id: "u1", role: "x", since: "2026-09-14T00:00:00Z" });
    expect("issues" in failed && failed.issues[0]).toEqual({
      message: 'expected one of "admin", "member", got "x"',
      path: ["role"],
    });
  });
});

describe("InferType is the narrow public surface", () => {
  // Test files are not type-checked by `tsc -b`, so the pin is syntactic: the
  // interface declaration itself. The LSP e2e (editor-lsp.test.ts) guards the
  // same four names through a real completion request on `User.`.
  it("declares exactly the four documented members — nothing else may reach editor completion on a type value", () => {
    const file = fileURLToPath(new URL("../src/types/infer-type.ts", import.meta.url));
    const sf = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
    const decl = sf.statements.find(
      (s): s is ts.InterfaceDeclaration => ts.isInterfaceDeclaration(s) && s.name.text === "InferType",
    );
    const members = (decl?.members ?? []).map((m) =>
      m.name && (ts.isIdentifier(m.name) || ts.isStringLiteral(m.name)) ? m.name.text : "<unnamed>",
    );
    expect(members.sort()).toEqual(["parse", "toJsonSchema", "validate", "~standard"]);
    // and the extends clauses add nothing beyond `~standard` (both specs share that one key)
    const bases = (decl?.heritageClauses ?? []).flatMap((h) => h.types.map((x) => x.expression.getText(sf)));
    expect(bases).toEqual(["StandardSchemaV1", "StandardJSONSchemaV1"]);
    const value = t.object({ id: t.string() }) as InferType<{ id: string }>;
    expect(value.parse({ id: "x" })).toEqual({ id: "x" });
  });
});
