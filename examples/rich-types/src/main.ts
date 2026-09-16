import { Counts, classify, Draft, PaymentEvent } from "./events.tsi";

const event = await classify("Customer disputed the $40 charge on 2026-01-03");
const schema = PaymentEvent.toJsonSchema() as { anyOf?: unknown[] };
console.log(
  JSON.stringify({
    event,
    branches: schema.anyOf?.length,
    draftRequired: (Draft.toJsonSchema() as { required?: string[] }).required,
    counts: Counts.validate({ a: 1, b: "x" }).ok,
  }),
);
