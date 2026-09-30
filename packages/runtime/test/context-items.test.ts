import { type InferenceModel, renderPrompt } from "@nola-lang/core";
import type { Frame } from "@nola-lang/runtime";
import { __nola, nolaRuntime } from "@nola-lang/runtime";
import { afterEach, describe, expect, it } from "vitest";

afterEach(() => nolaRuntime.reset());

const extract = () => __nola.intents.ExtractIntent<string>({ instruction: "a label", type: { type: "string" }, loc: "3:15" });

/** A probe model: records every default rendering it is sent. No telemetry: the default terminal trace would print every ask. */
function probe(payloads: string[]) {
  nolaRuntime.configure({
    model: {
      default: {
        name: "probe",
        infer: async (req) => {
          payloads.push(renderPrompt(req.intent).messages[0]?.content ?? "");
          return { text: '"x"' };
        },
      },
    },
    telemetry: [],
  });
}

describe("context items in the module body (spec 2026-09-29 §3.4)", () => {
  it("one prose item renders exactly as the old module instruction did", async () => {
    const payloads: string[] = [];
    probe(payloads);
    // one item, shared by the init and the ask — as lowering shares the hoisted `__nola_ctx_N` function
    const triage = () => "You triage support mail.";
    const scope = __nola.context.module("main.tsi", undefined, () => ({ context: [triage] }));
    await __nola.ask(extract(), scope, { context: [triage] });
    expect(payloads[0]).toBe('<context module="main.tsi">\nYou triage support mail.\n</context>\n\n<task>\na label\n</task>');
  });

  it("an item is read at each ask; the items are the block's first lines, the bindings follow", async () => {
    const payloads: string[] = [];
    probe(payloads);
    let brand = "Acme";
    const inbox = () => `Support inbox for ${brand}.`;
    const scope = __nola.context.module("main.tsi", undefined, () => ({ context: [inbox], locals: [{ name: "tone" }] }));
    await __nola.ask(extract(), scope, { locals: { tone: "brief" }, context: [inbox] });
    brand = "Globex";
    await __nola.ask(extract(), scope, { locals: { tone: "brief" }, context: [inbox] });
    expect(payloads[0]).toContain('<context module="main.tsi">\nSupport inbox for Acme.\n<input name="tone">\nbrief\n</input>\n</context>');
    expect(payloads[1]).toContain('<context module="main.tsi">\nSupport inbox for Globex.\n<input name="tone">\nbrief\n</input>\n</context>');
  });

  it("several items join with newlines in the order passed; an empty item is skipped; an ask that sees none renders no block", async () => {
    const payloads: string[] = [];
    probe(payloads);
    const a = () => "A";
    const empty = () => "";
    const b = () => "B";
    const scope = __nola.context.module("main.tsi", undefined, () => ({ context: [a, empty, b] }));
    await __nola.ask(extract(), scope, { context: [a, empty, b] });
    await __nola.ask(extract(), scope);
    expect(payloads[0]).toContain('<context module="main.tsi">\nA\nB\n</context>');
    expect(payloads[1]).toBe("<task>\na label\n</task>");
  });

  it("a throwing item fails the ask with its own error", async () => {
    probe([]);
    const boom = () => {
      throw new ReferenceError("brand is not defined");
    };
    const scope = __nola.context.module("main.tsi", undefined, () => ({ context: [boom] }));
    await expect(__nola.ask(extract(), scope, { context: [boom] })).rejects.toThrow(/brand is not defined/);
  });
});

describe("context items in an infer body", () => {
  it("the items an ask passes are the function's instruction lines, before its inputs; a later ask sees the live value", async () => {
    const payloads: string[] = [];
    probe(payloads);
    const file = __nola.context.module("x.tsi");
    const escalate = (ticket: string, oncall: string) =>
      __nola.intents.Intent(
        async (__frame: Frame) => {
          const page = () => `Page ${oncall} when the ticket is an outage.`;
          const steps: string[] = [];
          const soFar = () => `Steps taken so far: ${__nola.fmt(steps)}`;
          await __nola.ask(extract(), __frame, { context: [page, soFar] });
          steps.push("called the customer");
          await __nola.ask(extract(), __frame, { context: [page, soFar] });
          return steps;
        },
        file.func({
          fn: "escalate",
          args: [
            { name: "ticket", type: __nola.types.string(), contextual: true, value: ticket },
            { name: "oncall", type: __nola.types.string() },
          ],
        }),
      );
    await escalate("Order #1 arrived damaged.", "ada");
    expect(payloads[0]).toBe(
      [
        '<context function="escalate">',
        "Page ada when the ticket is an outage.",
        "Steps taken so far: []",
        '<input name="ticket">',
        "Order #1 arrived damaged.",
        "</input>",
        "</context>",
        "",
        "<task>",
        "a label",
        "</task>",
      ].join("\n"),
    );
    expect(payloads[1]).toContain('Steps taken so far: ["called the customer"]');
  });

  it("`ask fn()` carries the call site's items to the callee: the caller's block shows them", async () => {
    const payloads: string[] = [];
    probe(payloads);
    const file = __nola.context.module("x.tsi");
    const inner = () => __nola.intents.Intent(async (__frame: Frame) => __nola.ask(extract(), __frame), file.func({ fn: "inner" }));
    const outer = () =>
      __nola.intents.Intent(
        async (__frame: Frame) => {
          const note = () => "Be brief.";
          return __nola.ask(inner(), __frame, { context: [note] });
        },
        file.func({ fn: "outer" }),
      );
    await outer();
    expect(payloads[0]).toContain('<context function="outer">\nBe brief.\n</context>\n\n<context function="inner"/>');
  });
});

describe("the module block reaches the file's functions and renders once", () => {
  const A = () => "A";
  const B = () => "B";
  const C = () => "C";
  const moduleOf = (items: Array<() => string>) => __nola.context.module("b.tsi", undefined, () => ({ context: items }));
  const fnOf = (mod: ReturnType<typeof moduleOf>, name: string, moduleContext: Array<() => string>) => () =>
    __nola.intents.Intent(async (__frame: Frame) => __nola.ask(extract(), __frame), mod.func({ fn: name, moduleContext }));

  it("`await fn()` from outside renders the items above the function's declaration directly outside its block", async () => {
    const payloads: string[] = [];
    probe(payloads);
    const mod = moduleOf([A, B, C]);
    await fnOf(mod, "fn", [A, B])();
    expect(payloads[0]).toBe('<context module="b.tsi">\nA\nB\n</context>\n\n<context function="fn"/>\n\n<task>\na label\n</task>');
  });

  it("a function with no module items above it renders no module block", async () => {
    const payloads: string[] = [];
    probe(payloads);
    const mod = moduleOf([A]);
    await fnOf(mod, "top", [])();
    expect(payloads[0]).toBe('<context function="top"/>\n\n<task>\na label\n</task>');
  });

  it("`.detached()` renders like a bare await, module block included — even asked from a module scope that saw more items", async () => {
    const payloads: string[] = [];
    probe(payloads);
    const mod = moduleOf([A, B, C]);
    await fnOf(mod, "fn", [A, B])();
    await fnOf(mod, "fn", [A, B])().detached();
    // a detached root inherits nothing from the asking scope: its `[A, B, C]` view is not the callee's
    await __nola.ask(fnOf(mod, "fn", [A, B])().detached(), mod, { context: [A, B, C] });
    const rendered = '<context module="b.tsi">\nA\nB\n</context>\n\n<context function="fn"/>\n\n<task>\na label\n</task>';
    expect(payloads).toEqual([rendered, rendered, rendered]);
  });

  it("the module block renders once with the union: a module ask that saw [A] calling a function declared after B shows A and B", async () => {
    const payloads: string[] = [];
    probe(payloads);
    const mod = moduleOf([A, B]);
    await __nola.ask(fnOf(mod, "fn", [A, B])(), mod, { context: [A] });
    expect(payloads[0]).toBe('<context module="b.tsi">\nA\nB\n</context>\n\n<context function="fn"/>\n\n<task>\na label\n</task>');
    expect(payloads[0]?.match(/<context module="b\.tsi">/g)).toHaveLength(1);
  });

  it("…and the other way round: a module ask that saw [A, B, C] calling a function declared at the top shows all three", async () => {
    const payloads: string[] = [];
    probe(payloads);
    const mod = moduleOf([A, B, C]);
    await __nola.ask(fnOf(mod, "top", [])(), mod, { context: [A, B, C] });
    expect(payloads[0]).toContain('<context module="b.tsi">\nA\nB\nC\n</context>\n\n<context function="top"/>');
  });

  it("a block-scoped module item keeps its place after the top-level item before it", async () => {
    const payloads: string[] = [];
    probe(payloads);
    const nested = () => "N";
    const mod = moduleOf([A, B]);
    await __nola.ask(fnOf(mod, "fn", [A, B])(), mod, { context: [A, nested] });
    expect(payloads[0]).toContain('<context module="b.tsi">\nA\nN\nB\n</context>');
  });

  it("two functions of one module in a chain render the module once, outermost", async () => {
    const payloads: string[] = [];
    probe(payloads);
    const mod = moduleOf([A, B]);
    const inner = fnOf(mod, "inner", [A, B]);
    const outer = () =>
      __nola.intents.Intent(async (__frame: Frame) => __nola.ask(inner(), __frame), mod.func({ fn: "outer", moduleContext: [A] }));
    await outer();
    expect(payloads[0]).toBe(
      '<context module="b.tsi">\nA\nB\n</context>\n\n<context function="outer"/>\n\n<context function="inner"/>\n\n<task>\na label\n</task>',
    );
  });
});

// The cases of the retired lexical-module-instruction.test.ts that the sections above do not restate,
// in the item vocabulary: modules of several files, bindings, live reads on the lexical path, the wire.
describe("the module block across files, bindings and the wire", () => {
  const acme = () => "Acme support.";
  const tickets = () => "Handle Acme tickets.";
  const moduleAt = (file: string, items: Array<() => string>, locals?: Array<{ name: string }>) =>
    __nola.context.module(file, undefined, () => ({ context: items, ...(locals ? { locals } : {}) }));
  const fnIn =
    (mod: ReturnType<typeof moduleAt>, name: string, moduleContext: Array<() => string>, body?: (frame: Frame) => Promise<unknown>) =>
    () =>
      __nola.intents.Intent(
        async (__frame: Frame) => (body ? body(__frame) : __nola.ask(extract(), __frame)),
        mod.func({ fn: name, moduleContext }),
      );

  it("a cross-file call renders the caller's module, then the callee's module entered from it", async () => {
    const payloads: string[] = [];
    probe(payloads);
    const modA = moduleAt("a.tsi", [acme]);
    await __nola.ask(fnIn(moduleAt("b.tsi", [tickets]), "g", [tickets])(), modA, { context: [acme] });
    expect(payloads[0]).toContain(
      [
        '<context module="a.tsi">\nAcme support.\n</context>',
        '<context module="b.tsi">\nHandle Acme tickets.\n</context>',
        '<context function="g"/>',
      ].join("\n\n"),
    );
  });

  it("a call back into the caller's file does not render that module again", async () => {
    const payloads: string[] = [];
    probe(payloads);
    const modA = moduleAt("a.tsi", [acme]);
    const k = fnIn(modA, "k", [acme]);
    const g = fnIn(moduleAt("b.tsi", [tickets]), "g", [tickets], (frame) => __nola.ask(k(), frame));
    await __nola.ask(g(), modA, { context: [acme] });
    const text = payloads[0] ?? "";
    expect(text.match(/<context module="a\.tsi">/g)).toHaveLength(1);
    expect(text).toContain('<context function="k"/>');
  });

  it("bindings are not carried: a module with only locals is silent on the lexical path", async () => {
    const payloads: string[] = [];
    probe(payloads);
    await fnIn(moduleAt("l.tsi", [], [{ name: "tone" }]), "fn", [])();
    expect(payloads[0]).not.toContain('module="l.tsi"');
  });

  it("an item carried lexically is read at the callee's ask, with no bindings", async () => {
    const payloads: string[] = [];
    probe(payloads);
    let brand = "Acme";
    const handle = () => `Handle ${brand} tickets.`;
    const fn = fnIn(moduleAt("t.tsi", [handle], [{ name: "tone" }]), "fn", [handle]);
    await fn();
    brand = "Globex";
    await fn();
    expect(payloads[0]).toContain('<context module="t.tsi">\nHandle Acme tickets.\n</context>\n\n<context function="fn"/>');
    expect(payloads[1]).toContain('<context module="t.tsi">\nHandle Globex tickets.\n</context>\n\n<context function="fn"/>');
    expect(payloads[0]).not.toContain("tone");
    expect((payloads[0] ?? "").match(/<context function="fn"/g)).toHaveLength(1);
  });

  it("the wire model carries `lexical: true` on the definition module scope", async () => {
    const models: InferenceModel[] = [];
    nolaRuntime.configure({
      model: {
        default: {
          name: "wire",
          infer: async (req) => {
            models.push(req.intent);
            return { text: '"x"' };
          },
        },
      },
      telemetry: [],
    });
    await fnIn(moduleAt("b.tsi", [tickets]), "fn", [tickets])();
    expect(models[0]?.scope?.parent).toMatchObject({
      fn: "<module>",
      module: true,
      lexical: true,
      file: "b.tsi",
      instruction: "Handle Acme tickets.",
      args: [],
    });
    expect(models[0]?.scope?.lexical).toBeUndefined();
  });
});
