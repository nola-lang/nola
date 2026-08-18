import { mockProvider } from "@nola-lang/providers";
import { afterEach, describe, expect, it } from "vitest";
import { validate } from "../src/ask/validate.js";
import { __nola, ask, ExtractIntent, FunctionCallingIntent, nolaRuntime, inferTypes as t } from "../src/index.js";
import { openTestFrame } from "./helpers/frame.js";

const ISO = "2026-07-30T12:00:00.000Z";

afterEach(() => nolaRuntime.reset());

const ctx = () => openTestFrame();

describe("__nola.types.date()", () => {
  it("serializes to a string schema carrying format: date-time", () => {
    expect(t.date().toJsonSchema()).toEqual({ type: "string", format: "date-time" });
    expect(t.date().describe("date of birth").toJsonSchema()).toEqual({
      type: "string",
      format: "date-time",
      description: "date of birth",
    });
  });

  it("validate enforces parseability for format: date-time", () => {
    const schema = t.date().toJsonSchema();
    expect(validate(schema, ISO)).toEqual({ ok: true, value: ISO });
    expect(validate(schema, "not a date")).toMatchObject({ ok: false });
    expect(validate(schema, 1234)).toMatchObject({ ok: false });
  });

  it("revive turns a date leaf into a Date instance", () => {
    const revived = t.date().revive(ISO);
    expect(revived).toBeInstanceOf(Date);
    expect((revived as Date).getTime()).toBe(Date.parse(ISO));
  });

  it("revive walks objects, arrays, and optionals", () => {
    const type = t.object({
      name: t.string(),
      dob: t.date(),
      visits: t.array(t.date()),
      last: t.optional(t.date()),
    });
    const revived = type.revive({ name: "Ada", dob: ISO, visits: [ISO, ISO] }) as Record<string, unknown>;
    expect(revived.name).toBe("Ada");
    expect(revived.dob).toBeInstanceOf(Date);
    expect((revived.visits as unknown[])[1]).toBeInstanceOf(Date);
    expect("last" in revived).toBe(false);
  });

  it("revive follows refs, including cyclic ones, over the finite value", () => {
    const node: () => ReturnType<typeof t.object> = () =>
      t.object({ when: t.date(), next: t.optional(t.ref("Node", node)) });
    const value = { when: ISO, next: { when: ISO } };
    const revived = t.ref("Node", node).revive(value) as { when: Date; next: { when: Date } };
    expect(revived.when).toBeInstanceOf(Date);
    expect(revived.next.when).toBeInstanceOf(Date);
  });

  it("revive is identity (same reference) when the type contains no dates", () => {
    const type = t.object({ name: t.string(), tags: t.array(t.string()) });
    const value = { name: "Ada", tags: ["x"] };
    expect(type.revive(value)).toBe(value);
  });

  it("an extract ask resolves to a real Date", async () => {
    nolaRuntime.configure({ providers: { default: mockProvider([ISO]) } });
    const when = await ask(new ExtractIntent<Date>({ instruction: "when", type: t.date(), loc: "1:1" }), ctx());
    expect(when).toBeInstanceOf(Date);
    expect((when as Date).toISOString()).toBe(ISO);
  });

  it("call-intent slots revive before the function is invoked", async () => {
    nolaRuntime.configure({ providers: { default: mockProvider([{ arg0: ISO }]) } });
    let received: unknown;
    const save = (d: unknown) => {
      received = d;
      return "ok";
    };
    await ask(
      new FunctionCallingIntent<string>({
        fn: save,
        name: "save",
        loc: "1:1",
        args: [new ExtractIntent<Date>({ instruction: "when", type: t.date() })],
      }),
      ctx(),
    );
    expect(received).toBeInstanceOf(Date);
  });

  it("__nola.types exposes date (emit surface)", () => {
    expect(typeof __nola.types.date).toBe("function");
  });
});
