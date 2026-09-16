import { canonicalize, inferTypes as t } from "@nola-lang/runtime";
import { describe, expect, it } from "vitest";
import { TypeCarrier } from "../src/types/infer-type.js";

describe("InferType.toJsonSchema", () => {
  it("serializes scalars, enums, arrays, objects, optionals, descriptions", () => {
    const schema = t
      .object({
        name: t.string().describe("full name"),
        age: t.number(),
        vip: t.boolean(),
        tags: t.array(t.string()),
        tier: t.enum(["gold", "silver"]),
        nick: t.optional(t.string()),
      })
      .toJsonSchema();
    expect(schema).toEqual({
      type: "object",
      properties: {
        name: { type: "string", description: "full name" },
        age: { type: "number" },
        vip: { type: "boolean" },
        tags: { type: "array", items: { type: "string" } },
        tier: { type: "string", enum: ["gold", "silver"] },
        nick: { type: "string" },
      },
      required: ["name", "age", "vip", "tags", "tier"],
      additionalProperties: false,
    });
  });

  it("inlines non-cyclic refs (no $defs, no $ref in the output)", () => {
    const address = () => t.object({ city: t.string() });
    const user = t.object({ home: t.ref("Address", address), work: t.ref("Address", address) });
    expect(canonicalize(user.toJsonSchema())).toBe(
      canonicalize({
        type: "object",
        properties: {
          home: {
            type: "object",
            properties: { city: { type: "string" } },
            required: ["city"],
            additionalProperties: false,
          },
          work: {
            type: "object",
            properties: { city: { type: "string" } },
            required: ["city"],
            additionalProperties: false,
          },
        },
        required: ["home", "work"],
        additionalProperties: false,
      }),
    );
  });

  it("emits $defs/$ref only for cyclic refs", () => {
    const node = (): ReturnType<typeof t.object> =>
      t.object({ label: t.string(), kids: t.optional(t.array(t.ref("Node", node))) });
    const schema = node().toJsonSchema();
    expect(schema.$defs).toBeDefined();
    expect(Object.keys(schema.$defs ?? {})).toEqual(["Node"]);
    expect(JSON.stringify(schema)).toContain('"#/$defs/Node"');
  });

  it("describe() is immutable and TypeCarrier.is brands by property", () => {
    const a = t.string();
    const b = a.describe("x");
    expect(a).not.toBe(b);
    expect(a.toJsonSchema()).toEqual({ type: "string" });
    expect(TypeCarrier.is(b)).toBe(true);
    expect(TypeCarrier.is({ toJsonSchema() {} })).toBe(false);
  });
});

describe("TypeCarrier.refName", () => {
  it("names a root ref, strips a view's module qualifier, and is undefined for anonymous shapes", () => {
    const ticket = t.ref("Ticket", () => t.object({ id: t.string() }));
    expect(ticket.refName()).toBe("Ticket");
    expect(t.ref("src/types#Ticket", () => t.string()).refName()).toBe("Ticket");
    expect(t.object({ id: t.string() }).refName()).toBeUndefined();
    expect(t.string().refName()).toBeUndefined();
  });
});

describe("TypeCarrier.toTypeText", () => {
  it("prints TypeScript for every carrier shape", () => {
    expect(t.string().toTypeText()).toBe("string");
    expect(t.enum(["quote", "order"]).toTypeText()).toBe('"quote" | "order"');
    expect(t.number().toTypeText()).toBe("number");
    expect(t.boolean().toTypeText()).toBe("boolean");
    expect(t.date().toTypeText()).toBe("Date");
    expect(t.array(t.string()).toTypeText()).toBe("string[]");
    expect(t.array(t.enum(["a", "b"])).toTypeText()).toBe('("a" | "b")[]');
    expect(t.object({ id: t.string(), tags: t.array(t.string()), note: t.optional(t.string()) }).toTypeText()).toBe(
      "{ id: string; tags: string[]; note?: string }",
    );
    expect(t.object({}).toTypeText()).toBe("{}");
  });

  it("names a ref without expanding it, stripping a view qualifier; unsupported prints never", () => {
    expect(t.ref("Ticket", () => t.object({ id: t.string() })).toTypeText()).toBe("Ticket");
    expect(t.ref("src/types#Ticket", () => t.string()).toTypeText()).toBe("Ticket");
    expect(t.object({ owner: t.ref("User", () => t.string()) }).toTypeText()).toBe("{ owner: User }");
    expect(t.unsupported("no").toTypeText()).toBe("never");
  });
});

