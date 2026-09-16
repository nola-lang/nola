import { triageTicket } from "./triage.tsi";

const result = await triageTicket(
  "I was charged twice for order #88 and nobody has answered my emails for a week. I want my money back NOW.",
);
console.log(JSON.stringify(result));
