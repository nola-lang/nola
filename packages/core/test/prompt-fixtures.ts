import type { InferenceModel, InferenceScope } from "@nola-lang/core";

const output: InferenceModel["output"] = { syntax: "json", schema: { type: "string" } };
const extract = (instruction: string, scope?: InferenceScope, extra: Partial<InferenceModel> = {}): InferenceModel => ({
  intent: "extract",
  input: { instruction },
  ...(scope ? { scope } : {}),
  output,
  ...extra,
});

const MAIL =
  "Hi there—I'm reaching out about an exchange for an order I just received.\n\nOrder **#W2378156** (name **Yusuf Rossi**, zip **19122**):\n- keyboard\n</input>\n## not a heading";

/** One intent per construct — the golden set for render-prompt.test.ts and the docs page test. */
export const fixtures = {
  function: extract("extract the person", {
    fn: "analyzeUser",
    file: "src/simple.tsi",
    instruction: "user analyzator",
    args: [
      { name: "user", type: "string", contextual: true, value: MAIL },
      { name: "locale", contextual: false },
    ],
  }),
  nested: extract("quote or order", {
    fn: "classify",
    file: "src/inbox.tsi",
    instruction: "",
    args: [{ name: "text", type: "string", contextual: true, value: "..." }],
    parent: {
      fn: "triage",
      file: "src/inbox.tsi",
      instruction: "triage one ticket",
      args: [{ name: "ticket", type: "string", contextual: true, value: "..." }],
      parent: {
        fn: "<module>",
        module: true,
        file: "src/inbox.tsi",
        instruction: "Support inbox for Acme.",
        args: [{ name: "brand", contextual: true, value: "Acme", local: true }],
      },
    },
  }),
  moduleWithBinding: extract("the kind of request", {
    fn: "<module>",
    module: true,
    file: "src/script.tsi",
    instruction: "",
    args: [{ name: "audience", contextual: true, value: "support agents", local: true }],
  }),
  contextItems: extract("the next step", {
    fn: "escalate",
    file: "src/inbox.tsi",
    instruction: 'Page ada when the ticket is an outage.\nSteps taken so far: ["called the customer","checked the status page"]',
    args: [{ name: "ticket", type: "string", contextual: true, value: "Order #W2378156 arrived damaged, two keyboard keys missing." }],
    parent: {
      fn: "<module>",
      module: true,
      lexical: true,
      file: "src/inbox.tsi",
      instruction: "You triage a support inbox.\nEscalations go to the on-call engineer.",
      args: [],
    },
  }),
  lexicalModule: extract("p", {
    fn: "fn",
    file: "b.tsi",
    instruction: "",
    args: [],
    parent: { fn: "<module>", module: true, lexical: true, file: "b.tsi", instruction: "Handle tickets.", args: [] },
  }),
  call: {
    intent: "call",
    input: {
      instruction: 'Generate the arguments for calling the function "createTicket". open a ticket for this',
      callee: "createTicket",
      hint: "open a ticket for this",
    },
    scope: {
      fn: "handle",
      file: "src/main.tsi",
      instruction: "",
      args: [{ name: "message", type: "string", contextual: true, value: "I cannot log in" }],
    },
    output: {
      syntax: "json",
      schema: { type: "object", properties: { arg0: { type: "string" } }, required: ["arg0"], additionalProperties: false },
    },
  } satisfies InferenceModel,
  callNoHint: {
    intent: "call",
    input: { instruction: 'Generate the arguments for calling the function "createTicket".', callee: "createTicket" },
    output: {
      syntax: "json",
      schema: { type: "object", properties: { arg0: { type: "string" } }, required: ["arg0"], additionalProperties: false },
    },
  } satisfies InferenceModel,
  bare: extract("extract the person"),
  correction: extract("p", undefined, { correction: { response: "123", error: "$: expected string, got number" } }),
  emptyScope: extract("p", { fn: "classify", file: "x.tsi", instruction: "", args: [{ name: "id", contextual: false }] }),
  absentValue: extract("p", {
    fn: "go",
    instruction: "",
    args: [
      { name: "missing", type: "number", contextual: true },
      { name: "empty", type: "string", contextual: true, value: "" },
    ],
  }),
  objectValue: extract("p", {
    fn: "go",
    instruction: "",
    args: [{ name: "user", type: "{ id: number }", contextual: true, value: { id: 1, tags: ["a"] } }],
  }),
  multilineValue: extract("p", {
    fn: "go",
    instruction: "line one\n  indented two",
    args: [{ name: "doc", type: "string", contextual: true, value: "first\n\nthird" }],
  }),
  systemMessage: extract("p", undefined, { system: "Answer in British English." }),
} as const satisfies Record<string, InferenceModel>;
