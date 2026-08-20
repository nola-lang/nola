// The domain model, declared a second time in Ax's signature grammar. Ax infers
// its own result types from these strings — they have no connection to the
// interfaces in types.ts, so the two drift independently.
import { ax } from "@ax-llm/ax";

export const classifier = ax(
  'emailText:string "a customer email" -> kind:class "order, quote" "is the email placing an order or asking for a quote"',
);

export const orderExtractor = ax(`
  emailText:string "a customer email" ->
  order:object{
    customer:object{ name:string, company?:string },
    shipTo:object{ street:string, city:string, zip:string },
    items:object{ description:string, quantity:number }[],
    needBy?:datetime "requested delivery date, if the email names one",
    priority:class "standard, rush"
  } "the order request described in the email"
`);

// Ax has no single-shot "fill this function's arguments" primitive, so the
// quote branch extracts the arguments and the app dispatches the call itself.
export const quoteArgsExtractor = ax(`
  emailText:string "a customer email" ->
  summary:string "one line describing what the customer wants quoted",
  customerName:string "the customer's name"
`);
