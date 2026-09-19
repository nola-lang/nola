import type { ChatModel, InferModel, InferRequest, ProviderRequest } from "@nola-lang/core";
import { renderClassic } from "@nola-lang/core";
import { describe, expect, it } from "vitest";
import { callModel, isDecisionRequest } from "../src/dialect.js";
import { modelOf } from "./helpers/model.js";

const model = modelOf({ instruction: "hello" });
const inferReq: InferRequest = {
  model,
  params: { temperature: 0 },
  trace: { askId: "a", invocationId: "i", spanPath: [] },
  profile: "p",
};
const classicReq: ProviderRequest = { payload: renderClassic(model), params: { temperature: 0 } };

describe("callModel", () => {
  it("an infer inner receives the InferRequest untouched", async () => {
    let seen: InferRequest | undefined;
    const m: InferModel = {
      name: "i",
      infer: async (req) => {
        seen = req;
        return { text: "ok" };
      },
    };
    await callModel(m, inferReq);
    expect(seen).toBe(inferReq);
  });

  it("a chat inner receives the rendering of an infer request, with params/trace/profile kept", async () => {
    let seen: ProviderRequest | undefined;
    const m: ChatModel = {
      name: "c",
      complete: async (req) => {
        seen = req;
        return { text: "ok" };
      },
    };
    await callModel(m, inferReq);
    expect(seen?.payload).toEqual(renderClassic(model));
    expect(seen?.params).toEqual({ temperature: 0 });
    expect(seen?.trace).toEqual(inferReq.trace);
    expect(seen?.profile).toBe("p");
    expect("model" in (seen ?? {})).toBe(false);
  });

  it("a chat inner receives a classic request untouched", async () => {
    let seen: ProviderRequest | undefined;
    const m: ChatModel = {
      name: "c",
      complete: async (req) => {
        seen = req;
        return { text: "ok" };
      },
    };
    await callModel(m, classicReq);
    expect(seen).toBe(classicReq);
  });

  it("an infer inner cannot serve a classic request (the combinator's own dialect prevents it)", async () => {
    const m: InferModel = { name: "i", infer: async () => ({ text: "ok" }) };
    await expect(callModel(m, classicReq)).rejects.toThrow(/infer-dialect model "i" received a classic request/);
  });
});

describe("isDecisionRequest", () => {
  const decision = modelOf({ schema: { type: "number", minimum: 0, maximum: 1, "x-nola-decision": { kind: "prob" } } });
  it("reads the schema of either request shape", () => {
    expect(isDecisionRequest({ model: decision })).toBe(true);
    expect(isDecisionRequest({ payload: renderClassic(decision) })).toBe(true);
    expect(isDecisionRequest(inferReq)).toBe(false);
    expect(isDecisionRequest(classicReq)).toBe(false);
  });
});
