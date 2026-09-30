import { renderContextBlock } from "@nola-lang/core";
import { InferContext, ModuleContext, nolaRuntime, SystemInferContext } from "@nola-lang/runtime";
import { beforeEach, describe, expect, it } from "vitest";

const system = (message?: string) => SystemInferContext.create(() => message, nolaRuntime.current());
const mod = (sys = system(), path = "src/x.tsi") => ModuleContext.create(path, {}, nolaRuntime.current(), sys);

/**
 * Capturing composer for asserting what a single node contributes to the
 * composed model — a scope() description is rendered through renderContextBlock
 * (the same rendering ModelBuilder drives) into `texts`; intent()/outer() are
 * unused by these node-level tests.
 */
const capture = () => {
  const texts: string[] = [];
  const scopeSink = {
    describe(init: { fn: string; file?: string; instruction: string; args: readonly { name: string; type?: { toNativeType(): string }; contextual: boolean; value?: unknown }[] }) {
      texts.push(renderContextBlock({ ...init, args: init.args.map((a) => ({ ...a, type: a.type?.toNativeType() })) }));
      return this;
    },
  };
  const intentSink = {
    input() {
      return this;
    },
    output() {
      return this;
    },
  };
  const composer = {
    intent: () => intentSink,
    scope: () => scopeSink,
    outer: () => composer,
  };
  // biome-ignore lint/suspicious/noExplicitAny: a minimal test double, not the real InferenceComposer
  return { texts, composer: composer as any };
};

describe("SystemInferContext", () => {
  it("systemMessage is undefined when no message is configured", () => {
    expect(system().systemMessage).toBeUndefined();
  });

  it("systemMessage returns the configured message", () => {
    expect(system("Be terse.").systemMessage).toBe("Be terse.");
  });

  it("reads the message thunk lazily (config latched after creation)", () => {
    let msg: string | undefined;
    const sys = SystemInferContext.create(() => msg, nolaRuntime.current());
    expect(sys.systemMessage).toBeUndefined();
    msg = "later";
    expect(sys.systemMessage).toBe("later");
  });

  it("the system node and a module node with nothing to say contribute nothing to the composed prompt", () => {
    const { texts, composer } = capture();
    system().compose(composer);
    mod().compose(composer);
    expect(texts).toEqual([]);
  });
});

describe("ModuleContext (the file root since emit 19)", () => {
  it("is parented under the system context with a typed file getter", () => {
    const sys = system();
    const m = mod(sys);
    expect(m.parent).toBe(sys);
    expect(m.file).toBe("src/x.tsi");
  });

  it("sourceFile() walks the lineage to the nearest module node", () => {
    const fn = mod().func({ fn: "go" });
    expect(fn.sourceFile()).toBe("src/x.tsi");
    expect(fn.scope({ step: 1 }).sourceFile()).toBe("src/x.tsi");
    expect(system().scope({ notFile: 1 }).sourceFile()).toBe("<unknown>");
  });
});

describe("InvocationContext", () => {
  it("normalizes init: moduleContext defaults to empty, args to []", () => {
    const fn = mod().func({ fn: "go" });
    expect(fn.data.fn).toBe("go");
    expect(fn.data.moduleContext).toEqual([]);
    expect(fn.data.args).toEqual([]);
  });

  it("composes no input when args are empty", () => {
    const fn = mod().func({ fn: "go" });
    const { texts, composer } = capture();
    fn.compose(composer, { context: [() => "do it"] });
    expect(texts).toEqual(['<context function="go">\ndo it\n</context>']);
  });

  it("composes a value only when contextual; plain args are not rendered", () => {
    const fakeType = { toNativeType: () => "string" } as never;
    const fn = mod().func({
      fn: "go",
      args: [
        { name: "user", type: fakeType, contextual: true, value: { id: 1 } },
        { name: "limit", type: fakeType },
        { name: "cb" },
      ],
    });
    const { texts, composer } = capture();
    fn.compose(composer);
    expect(texts[0]).toContain('<input name="user">\n{\n  "id": 1\n}\n</input>');
    expect(texts[0]).not.toContain("limit");
    expect(texts[0]).not.toContain("cb");
  });
});

describe("NolaRuntime.system", () => {
  beforeEach(() => nolaRuntime.reset());

  it("is lazy, memoized per runtime instance, and parents every module node", () => {
    const rt = nolaRuntime.current();
    expect(rt.system).toBe(rt.system);
    const m = rt.moduleContext("src/a.tsi");
    expect(m).toBeInstanceOf(ModuleContext);
    expect(m.parent).toBe(rt.system);
    expect(rt.moduleContext("src/a.tsi")).toBe(m);
  });

  it("systemMessage picks up config set after the system context was created", () => {
    const rt = nolaRuntime.current();
    const sys = rt.system; // created before configure
    nolaRuntime.configure({
      model: { default: { name: "mock", infer: async () => ({ text: '"x"' }) } },
      system: { message: "Be terse." },
    });
    expect(sys.systemMessage).toBe("Be terse.");
  });

  it("nolaRuntime.reset() discards the system context with the runtime", () => {
    const before = nolaRuntime.current().system;
    nolaRuntime.reset();
    expect(nolaRuntime.current().system).not.toBe(before);
  });

  it("moduleContext is memoized per path; reset() clears the memo", () => {
    const rt = nolaRuntime.current();
    expect(rt.moduleContext("a.tsi")).toBe(rt.moduleContext("a.tsi"));
    expect(rt.moduleContext("a.tsi")).not.toBe(rt.moduleContext("b.tsi"));
    const before = rt.moduleContext("a.tsi");
    nolaRuntime.reset();
    expect(nolaRuntime.current().moduleContext("a.tsi")).not.toBe(before);
  });
});

describe("base InferContext", () => {
  it("scope() still creates anonymous plain children (composing nothing)", () => {
    const child = mod().scope({ extra: 1 });
    expect(child).toBeInstanceOf(InferContext);
    expect(child).not.toBeInstanceOf(ModuleContext);
    const { texts, composer } = capture();
    child.compose(composer);
    expect(texts).toEqual([]);
  });
});
