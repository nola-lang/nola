import { Codes } from "@nola-lang/ast";
import type { InferenceModel } from "@nola-lang/core";
import { mockProvider, toolCalls } from "@nola-lang/providers";
import { ask, ExtractIntent, FunctionCallIntent, nolaRuntime, ToolUseIntent, inferTypes as t, toolSource } from "@nola-lang/runtime";
import { afterEach, describe, expect, it } from "vitest";
import { instructionParts } from "../src/intents/parts.js";
import { openTestFrame } from "./helpers/frame.js";

afterEach(() => nolaRuntime.reset());

const searchArgs = t.object({ dir: t.string() }).describe("Search files under a directory.");
const search = (dir: string) => [`${dir}/a.pdf`];
const searchTwin = (dir: string) => [`${dir}/b.pdf`];

describe("an ask sequence at run time (spec 2026-10-12 §3.6)", () => {
  it("an extract sequence composes the reference text and the parts; history records the reference text", async () => {
    const requests: InferenceModel[] = [];
    nolaRuntime.configure({
      model: {
        default: mockProvider((req) => {
          requests.push(req.intent);
          return "Ada";
        }),
      },
    });
    const frame = openTestFrame();
    const intent = new ExtractIntent<string>({
      instruction: ["the owner of", instructionParts.obj({ value: { id: "p-1" }, name: "project", type: t.object({ id: t.string() }) }), "by name"],
      type: t.string(),
      loc: "3:11",
    });
    await expect(ask(intent, frame)).resolves.toBe("Ada");
    expect(requests[0]?.input).toEqual({
      instruction: "the owner of project by name",
      parts: [{ text: "the owner of" }, { input: { name: "project", type: "object", value: { id: "p-1" } } }, { text: "by name" }],
    });
    expect(frame.history).toEqual([{ prompt: "the owner of project by name", value: "Ada" }]);
    expect(intent.describe()).toBe("the owner of project by name");
  });

  it("a part a class does not take is an error at construction", () => {
    const thrown = (build: () => unknown): unknown => {
      try {
        build();
      } catch (e) {
        return e;
      }
      return undefined;
    };
    expect(
      thrown(
        () =>
          new ExtractIntent({ instruction: ["x", instructionParts.tools(toolSource(search, searchArgs, "search"))], type: t.string(), loc: "1:1" }),
      ),
    ).toMatchObject({ code: Codes.EmitContractMismatch, message: expect.stringContaining("ExtractIntent takes no tools part") });
    expect(
      thrown(
        () =>
          new ToolUseIntent({ instruction: ["x", instructionParts.func({ fn: search, name: "search", args: [] })], type: t.string(), loc: "1:1" }),
      ),
    ).toMatchObject({ code: Codes.EmitContractMismatch });
    expect(thrown(() => new FunctionCallIntent({ instruction: ["x"], loc: "1:1" }))).toMatchObject({ code: Codes.EmitContractMismatch });
  });

  it("a call sequence: the words are the task, the func part is called with the filled slots", async () => {
    const requests: InferenceModel[] = [];
    const seen: unknown[][] = [];
    const createUser = async (id: string, n: number) => {
      seen.push([id, n]);
      return { id };
    };
    nolaRuntime.configure({
      model: {
        default: mockProvider((req) => {
          requests.push(req.intent);
          return { arg0: "u-7" };
        }),
      },
    });
    const intent = new FunctionCallIntent<{ id: string }>({
      instruction: [
        "register",
        instructionParts.func({
          fn: createUser,
          name: "createUser",
          args: [new ExtractIntent({ instruction: "user id", type: t.string(), loc: "1:30" }), 42],
        }),
        "with",
        instructionParts.obj({ value: { plan: "free" }, name: "defaults" }),
      ],
      loc: "1:11",
    });
    await expect(ask(intent, openTestFrame())).resolves.toEqual({ id: "u-7" });
    expect(seen).toEqual([["u-7", 42]]);
    expect(requests[0]?.intent).toBe("call");
    expect(requests[0]?.input).toEqual({
      instruction: "register createUser(user id, 42) with defaults",
      callee: "createUser",
      parts: [{ text: "register" }, { call: "createUser(user id, 42)" }, { text: "with" }, { input: { name: "defaults", value: { plan: "free" } } }],
    });
  });

  it("a tool-use sequence unions its lists: the same function in two lists is one tool, the parts keep each list's names", async () => {
    const requests: InferenceModel[] = [];
    nolaRuntime.configure({
      model: {
        default: mockProvider(
          (req) => {
            requests.push(req.intent);
            return req.intent.transcript ? ["D:/a.pdf"] : toolCalls([{ name: "search", args: { dir: "D:" } }]);
          },
          { tools: true },
        ),
      },
    });
    const intent = new ToolUseIntent<string[]>({
      instruction: [
        "find",
        instructionParts.tools(toolSource(search, searchArgs, "search")),
        "or",
        instructionParts.tools(toolSource(search, searchArgs, "search"), toolSource(searchTwin, searchArgs, "searchTwin")),
        "done",
      ],
      type: t.array(t.string()),
      loc: "1:15",
    });
    await expect(ask(intent, openTestFrame())).resolves.toEqual(["D:/a.pdf"]);
    expect(requests[0]?.tools?.map((x) => x.name)).toEqual(["search", "searchTwin"]);
    expect(requests[0]?.input).toEqual({
      instruction: "find [search] or [search, searchTwin] done",
      parts: [{ text: "find" }, { tools: ["search"] }, { text: "or" }, { tools: ["search", "searchTwin"] }, { text: "done" }],
    });
  });

  it("two different functions under one name across lists are NOLA3022 before the network", async () => {
    nolaRuntime.configure({ model: { default: mockProvider(["never"], { tools: true }) } });
    const intent = new ToolUseIntent<string[]>({
      instruction: [
        "find",
        instructionParts.tools(toolSource(search, searchArgs, "search")),
        "or",
        instructionParts.tools(toolSource(searchTwin, searchArgs, "search")),
      ],
      type: t.array(t.string()),
      loc: "1:15",
    });
    await expect(ask(intent, openTestFrame())).rejects.toMatchObject({ code: Codes.ToolListInvalid });
  });

  it("a stored sequence used as a call slot describes its property with the values inline", async () => {
    const requests: InferenceModel[] = [];
    const f = (a: string) => a;
    nolaRuntime.configure({
      model: {
        default: mockProvider((req) => {
          requests.push(req.intent);
          return { arg0: "ok" };
        }),
      },
    });
    const slot = new ExtractIntent<string>({
      instruction: ["pick", instructionParts.obj({ value: ["x", "y"], name: "options" })],
      type: t.string(),
      loc: "1:1",
    });
    await ask(new FunctionCallIntent<string>({ fn: f, name: "f", args: [slot], instruction: "", loc: "2:1" }), openTestFrame());
    const props = (requests[0]?.output.schema as { properties: Record<string, { description?: string }> }).properties;
    expect(props.arg0?.description).toBe('pick ["x","y"]');
  });
});
