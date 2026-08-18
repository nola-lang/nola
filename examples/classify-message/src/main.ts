import { classifyMessage } from "./classify.tsi";

const result = await classifyMessage(
  "I was charged twice for order #88 and nobody has answered my emails for a week. I want my money back NOW.",
);
console.log(JSON.stringify(result));
