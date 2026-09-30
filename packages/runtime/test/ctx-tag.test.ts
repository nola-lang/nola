// biome-ignore-all lint/suspicious/noTemplateCurlyInString: the tag's raw text contains a literal ${
import { __nola, nolaRuntime } from "@nola-lang/runtime";
import { afterEach, describe, expect, it } from "vitest";

afterEach(() => nolaRuntime.reset());

describe("__nola.ctx — the context statement tag (spec 2026-09-29 §3.4)", () => {
  it("renders the text with each value formatted by fmt: a string verbatim, anything else JSON", () => {
    const user = "Ada";
    const steps = ["called the customer", "checked the status page"];
    expect(__nola.ctx`Page ${user} when needed. Steps: ${steps}`).toBe(
      'Page Ada when needed. Steps: ["called the customer","checked the status page"]',
    );
  });

  it("an empty hole joins two texts with nothing between them — the lowering's `$`-guard", () => {
    expect(__nola.ctx`cost $${""}{x}`).toBe("cost ${x}");
  });

  it("a function renders as its name, a nameless one as (anonymous) — inside arrays and objects too", () => {
    function weather() {}
    const create = () => 1;
    expect(__nola.ctx`use ${weather} or any of ${[weather, create]}`).toBe('use weather or any of ["weather","create"]');
    expect(__nola.fmt(() => 1)).toBe("(anonymous)");
    expect(__nola.fmt({ tool: weather })).toBe('{"tool":"weather"}');
  });

  it("a call intent renders as its callee, slot prompts and hint; an extractor as its prompt; an infer function's intent as its name", () => {
    const extract = __nola.intents.ExtractIntent<string>({ instruction: "user r", type: { type: "string" }, loc: "1:1" });
    function foo(_a: string) {}
    const withHint = __nola.intents.FunctionCallIntent({ fn: foo, name: "foo", instruction: "only if needed", loc: "1:1", args: [extract] });
    const bare = __nola.intents.FunctionCallIntent({ fn: foo, name: "foo", instruction: "", loc: "1:1", args: [extract] });
    expect(__nola.fmt(withHint)).toBe("foo(user r): only if needed");
    expect(__nola.fmt(bare)).toBe("foo(user r)");
    expect(__nola.fmt(extract)).toBe("user r");
    const go = __nola.intents.Intent(async () => 1, __nola.context.module("x.tsi").func({ fn: "go" }));
    expect(__nola.fmt(go)).toBe("go");
    expect(__nola.fmt([withHint])).toBe('["foo(user r): only if needed"]');
  });

  it("a call intent's arguments are formatted as fmt formats values: a slot nested in an object renders as its prompt, and nothing of the runtime leaks into the text", () => {
    const to = __nola.intents.ExtractIntent<string>({ instruction: "the recipient", type: { type: "string" }, loc: "1:1" });
    function send(_args: unknown) {}
    // the shape a slot nested in an object literal lowers to: `send({ to: ..`the recipient` })`
    const nested = __nola.intents.FunctionCallIntent({ fn: send, name: "send", instruction: "", loc: "1:1", args: [{ to }] });
    const described = __nola.fmt(nested);
    expect(described).toBe('send({"to":"the recipient"})');
    expect(described).not.toContain("inferContext");
    expect(described).not.toContain("file:///");
    // the text is what a context statement puts in front of the model (and the ask fingerprint)
    expect(__nola.ctx`Call ${nested} when asked.`).toBe('Call send({"to":"the recipient"}) when asked.');
    // inside an array too
    const many = __nola.intents.FunctionCallIntent({ fn: send, name: "send", instruction: "", loc: "1:1", args: [[to, to]] });
    expect(__nola.fmt(many)).toBe('send(["the recipient","the recipient"])');
  });

  it("a call intent's function argument renders as its name; a string verbatim, a number as JSON, undefined spelled out", () => {
    function weather() {}
    function send(..._args: unknown[]) {}
    const to = __nola.intents.ExtractIntent<string>({ instruction: "the recipient", type: { type: "string" }, loc: "1:1" });
    const call = __nola.intents.FunctionCallIntent({
      fn: send,
      name: "send",
      instruction: "when asked",
      loc: "1:1",
      args: [weather, [weather, to], "bob", 3, undefined],
    });
    expect(__nola.fmt(call)).toBe('send(weather, ["weather","the recipient"], bob, 3, undefined): when asked');
  });

  it("the data rules are unchanged: number, null, undefined, a Date", () => {
    expect(__nola.fmt(3)).toBe("3");
    expect(__nola.fmt(null)).toBe("null");
    expect(__nola.fmt(undefined)).toBe("undefined");
    expect(__nola.fmt(new Date(0))).toBe('"1970-01-01T00:00:00.000Z"');
  });
});
