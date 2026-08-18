import { FileInferContext, InferContext, nolaRuntime, SYSTEM_PREAMBLE, SystemInferContext } from "@nola-lang/runtime";
import { beforeEach, describe, expect, it } from "vitest";

const system = (message?: string) => SystemInferContext.create(() => message, nolaRuntime.current());
const file = (sys = system(), path = "src/x.tsi") => FileInferContext.create(path, sys, nolaRuntime.current());

/** Capturing composer for asserting what a single node contributes. */
const capture = () => {
  const texts: string[] = [];
  return { texts, composer: { addText: (t: string) => texts.push(t), addSchema: () => { } } };
};

describe("SystemInferContext", () => {
  it("systemText is the bare preamble when no message is configured", () => {
    expect(system().systemText()).toBe(SYSTEM_PREAMBLE);
  });

  it("systemText composes preamble + blank line + message", () => {
    expect(system("Be terse.").systemText()).toBe(`${SYSTEM_PREAMBLE}\n\nBe terse.`);
  });

  it("reads the message thunk lazily (config latched after creation)", () => {
    let msg: string | undefined;
    const sys = SystemInferContext.create(() => msg, nolaRuntime.current());
    expect(sys.systemMessage).toBeUndefined();
    msg = "later";
    expect(sys.systemMessage).toBe("later");
  });

  it("system and file nodes contribute nothing to the composed prompt", () => {
    const { texts, composer } = capture();
    system().composeInferenceData(composer);
    file().composeInferenceData(composer);
    expect(texts).toEqual([]);
  });
});

describe("FileInferContext", () => {
  it("is parented under the system context with a typed file getter", () => {
    const sys = system();
    const f = file(sys);
    expect(f.parent).toBe(sys);
    expect(f.file).toBe("src/x.tsi");
  });

  it("sourceFile() walks the lineage to the nearest file node", () => {
    const fn = file().func({ fn: "go" });
    expect(fn.sourceFile()).toBe("src/x.tsi");
    expect(fn.scope({ step: 1 }).sourceFile()).toBe("src/x.tsi");
    expect(system().scope({ notFile: 1 }).sourceFile()).toBe("<unknown>");
  });
});

describe("FunctionInferContext", () => {
  it("normalizes init: instruction defaults to empty, args to []", () => {
    const fn = file().func({ fn: "go" });
    expect(fn.data.fn).toBe("go");
    expect(fn.data.instruction).toBe("");
    expect(fn.data.args).toEqual([]);
  });

  it("composes no Arguments section when args are empty", () => {
    const fn = file().func({ fn: "go", instruction: "do it" });
    const { texts, composer } = capture();
    fn.composeInferenceData(composer);
    expect(texts).toEqual(["CONTEXT — inside go(), src/x.tsi\nPurpose: do it"]);
  });

  it("composes arg types via toNativeType; value only when contextual", () => {
    const fakeType = { toNativeType: () => "string" } as never;
    const fn = file().func({
      fn: "go",
      args: [
        { name: "user", type: fakeType, contextual: true, value: { id: 1 } },
        { name: "limit", type: fakeType },
        { name: "cb" },
      ],
    });
    const { texts, composer } = capture();
    fn.composeInferenceData(composer);
    expect(texts[0]).toContain('- user (string) = {"id":1}');
    expect(texts[0]).toContain("- limit = (value not available)");
    expect(texts[0]).toContain("- cb = (value not available)");
  });
});

describe("NolaRuntime.system", () => {
  beforeEach(() => nolaRuntime.reset());

  it("is lazy, memoized per runtime instance, and parents every file context", () => {
    const rt = nolaRuntime.current();
    expect(rt.system).toBe(rt.system);
    const f = rt.fileContext("src/a.tsi");
    expect(f).toBeInstanceOf(FileInferContext);
    expect(f.parent).toBe(rt.system);
    expect(rt.fileContext("src/a.tsi")).toBe(f);
  });

  it("systemText picks up config set after the system context was created", () => {
    const rt = nolaRuntime.current();
    const sys = rt.system; // created before configure
    nolaRuntime.configure({
      providers: { default: { name: "mock", complete: async () => ({ text: '"x"' }) } },
      system: { message: "Be terse." },
    });
    expect(sys.systemText()).toBe(`${SYSTEM_PREAMBLE}\n\nBe terse.`);
  });

  it("nolaRuntime.reset() discards the system context with the runtime", () => {
    const before = nolaRuntime.current().system;
    nolaRuntime.reset();
    expect(nolaRuntime.current().system).not.toBe(before);
  });

  it("fileContext is memoized per path; reset() clears the memo", () => {
    const rt = nolaRuntime.current();
    expect(rt.fileContext("a.tsi")).toBe(rt.fileContext("a.tsi"));
    expect(rt.fileContext("a.tsi")).not.toBe(rt.fileContext("b.tsi"));
    const before = rt.fileContext("a.tsi");
    nolaRuntime.reset();
    expect(nolaRuntime.current().fileContext("a.tsi")).not.toBe(before);
  });
});

describe("base InferContext", () => {
  it("scope() still creates anonymous plain children (composing nothing)", () => {
    const child = file().scope({ extra: 1 });
    expect(child).toBeInstanceOf(InferContext);
    expect(child).not.toBeInstanceOf(FileInferContext);
    const { texts, composer } = capture();
    child.composeInferenceData(composer);
    expect(texts).toEqual([]);
  });
});
