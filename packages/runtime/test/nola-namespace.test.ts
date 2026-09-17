import { isPlatformModel } from "@nola-lang/core";
import { mockProvider } from "@nola-lang/providers";
import { nola, nolaRuntime, resolveNolaConfig, TRACER_HOOK } from "@nola-lang/runtime";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  nolaRuntime.reset();
  vi.unstubAllEnvs();
});

describe("nola — the namespace (config v2 §1)", () => {
  it("is a frozen object with exactly infer and tracer, and is not callable", () => {
    expect(Object.isFrozen(nola)).toBe(true);
    expect(Object.keys(nola).sort()).toEqual(["infer", "tracer"]);
    expect(typeof nola).toBe("object");
  });
});

describe("nola.infer()", () => {
  it("returns the platform model; no argument lets the platform choose", () => {
    const model = nola.infer();
    expect(isPlatformModel(model)).toBe(true);
    expect(model.name).toBe("nola");
    // the resolved config admits it as the bare model
    expect(Object.keys(resolveNolaConfig({ model }).model)).toEqual(["default"]);
  });

  it("a string is the upstream selector on the wire; options carry baseUrl and apiKey", async () => {
    const calls: { url: string; body: Record<string, unknown> }[] = [];
    const fetchSpy = (async (url: unknown, init?: RequestInit) => {
      calls.push({ url: String(url), body: JSON.parse(String(init?.body)) as Record<string, unknown> });
      return new Response(JSON.stringify({ text: "ok" }), { status: 200 });
    }) as typeof globalThis.fetch;
    const model = nola.infer({ model: "openai/gpt-5-mini", baseUrl: "http://localhost:8787", apiKey: "k", retry: false, fetch: fetchSpy });
    await model.infer({ model: {} as never });
    expect(calls[0]?.url).toBe("http://localhost:8787/v1/infer");
    expect(calls[0]?.body.model).toBe("openai/gpt-5-mini");
    expect(isPlatformModel(nola.infer("openai/gpt-5-mini"))).toBe(true);
  });

  it("is legal only as the bare model or the map's default; the position error names the fix", () => {
    expect(() => resolveNolaConfig({ model: { default: mockProvider(["x"]), fast: nola.infer() } })).toThrow(
      /model\.fast: the platform model can only be the root `default` — route locally with provider-factory models, or put "nola" in `default`/,
    );
    expect(Object.keys(resolveNolaConfig({ model: { default: nola.infer(), fast: mockProvider(["x"]) } }).model)).toEqual([
      "default",
      "fast",
    ]);
  });

  it("a string in the model slot names nola.infer(selector) as the fix", () => {
    expect(() => resolveNolaConfig({ model: "openai/gpt-5-mini" as never })).toThrow(/nola\.infer\("<provider>\/<model>"\)/);
  });
});

describe("nola.tracer()", () => {
  it("with no target resolves NOLA_API_URL, then api.nola.sh, at request time", async () => {
    const fn = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubEnv("NOLA_API_URL", "http://localhost:8787");
    const t = nola.tracer({ fetch: fn as unknown as typeof fetch });
    expect(t.name).toBe(TRACER_HOOK);
    t.onAskStart?.({ askId: "a1", site: { file: "x.tsi", loc: "1:1" }, provider: "mock" } as never);
    await new Promise((r) => setTimeout(r, 0));
    expect(String(fn.mock.calls[0]?.[0])).toBe("http://localhost:8787/v1/ingest");
  });

  it("a URL string is the target", () => {
    expect(nola.tracer("http://localhost:4141").name).toBe(TRACER_HOOK);
  });
});
