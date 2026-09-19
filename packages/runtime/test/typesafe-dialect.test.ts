import { mockProvider, typesafe } from "@nola-lang/providers";
import { type AskEndEvent, nolaRuntime, inferTypes as t } from "@nola-lang/runtime";
import { afterEach, describe, expect, it } from "vitest";
import { openTestFrame } from "./helpers/frame.js";
import { askViaInference } from "./helpers/inference.js";

afterEach(() => nolaRuntime.reset());

type Body = { state: unknown; questions: Record<string, { instructions: unknown }> };
function fakeFetch(answers: Record<string, unknown>) {
  const bodies: Body[] = [];
  const fn = (async (_url: unknown, init: unknown) => {
    bodies.push(JSON.parse(String((init as RequestInit).body)) as Body);
    return new Response(JSON.stringify({ model: "jev-latest", answers }));
  }) as typeof globalThis.fetch;
  return { fn, bodies };
}

const triage = t
  .object({
    department: t.choice({ billing: "Payments", sales: null }).describe("Which team?"),
    mood: t.scale(["Calm", "Angry"]).describe("How frustrated?"),
    urgent: t.prob().describe("Urgent?"),
    refund: t.boolean().describe("Refund asked?"),
  })
  .toJsonSchema();

const wire = {
  department: { type: "choice", choice: "billing", probabilities: { billing: 0.9, sales: 0.1 }, confidence: 0.9 },
  mood: { type: "score", score: 0.7, probabilities: { "0": 0.3, "1": 0.7 }, confidence: 0.4 },
  urgent: { type: "noul", noul: 0.92 },
  refund: { type: "noul", noul: 0.5 },
};

const frame = () =>
  openTestFrame({
    data: {
      fn: "triage",
      instruction: "You triage tickets.",
      args: [{ name: "ticket", contextual: true, value: "charged twice" }],
    },
  });

describe("typesafe() through the runtime", () => {
  it("receives the model, sends the frame's contextual values as state, and the answers validate", async () => {
    const { fn, bodies } = fakeFetch(wire);
    const receipts: AskEndEvent[] = [];
    nolaRuntime.configure({
      model: { default: typesafe({ apiKey: "k", fetch: fn }) },
      telemetry: [{ onAskEnd: (e) => receipts.push(e) }],
    });
    const result = await askViaInference({ frame: frame(), prompt: "triage the ticket", schema: triage, loc: "1:1" });
    expect(result).toEqual({
      department: { choice: "billing", probabilities: { billing: 0.9, sales: 0.1 }, confidence: 0.9 },
      mood: { score: 0.7, probabilities: [0.3, 0.7], levels: ["Calm", "Angry"], confidence: 0.4 },
      urgent: 0.92,
      refund: false,
    });
    expect(bodies[0]?.state).toEqual({ ticket: "charged twice" });
    expect(bodies[0]?.questions.department?.instructions).toEqual({
      context: "You triage tickets.\n\ntriage the ticket",
      question: "Which team?",
    });
    expect(receipts[0]?.receipt.outcome.ok).toBe(true);
  });

  it("the ask fingerprint is the same through typesafe() and through a chat mock (the rendering keys both)", async () => {
    const seen: string[] = [];
    const record = { onAskEnd: (e: AskEndEvent) => seen.push(e.receipt.fingerprint ?? "") };
    const plain = t.object({ refund: t.boolean() }).toJsonSchema();
    nolaRuntime.configure({
      model: { default: typesafe({ apiKey: "k", fetch: fakeFetch({ refund: { type: "noul", noul: 0.9 } }).fn }) },
      telemetry: [record],
    });
    await askViaInference({ frame: frame(), prompt: "p", schema: plain, loc: "1:1" });
    nolaRuntime.reset();
    nolaRuntime.configure({ model: { default: mockProvider([{ refund: true }]) }, telemetry: [record] });
    await askViaInference({ frame: frame(), prompt: "p", schema: plain, loc: "1:1" });
    expect(seen).toHaveLength(2);
    expect(seen[0]).toBe(seen[1]);
    expect(seen[0]).not.toBe("");
  });
});
