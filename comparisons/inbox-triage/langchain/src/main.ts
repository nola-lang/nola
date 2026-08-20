import { ChatOpenAI } from "@langchain/openai";
import { tool } from "langchain";
import * as z from "zod";
import { placeOrder, requestQuote } from "./handlers.js";
import { EmailKindSchema, OrderRequestSchema } from "./schemas.js";
import type { OrderRequest } from "./types.js";

const model = new ChatOpenAI({ model: "gpt-5-mini" });

const requestQuoteTool = tool(
  ({ summary, customerName }) => requestQuote(summary, customerName),
  {
    name: "request_quote",
    description: "Queue a quote request for a customer",
    schema: z.object({
      summary: z.string().describe("one line describing what the customer wants quoted"),
      customerName: z.string().describe("the customer's name"),
    }),
  },
);

async function triageEmail(email: string): Promise<string> {
  const { kind } = await model
    .withStructuredOutput(EmailKindSchema)
    .invoke(`Is this email placing an order or asking for a quote?\n\n${email}`);

  if (kind === "order") {
    const raw = await model
      .withStructuredOutput(OrderRequestSchema)
      .invoke(`Extract the order request described in the email.\n\n${email}`);
    // Bridge the wire shape back to the domain type: needBy arrives as an
    // ISO string and has to be revived into a Date by hand.
    const order: OrderRequest = {
      ...raw,
      needBy: raw.needBy ? new Date(raw.needBy) : undefined,
    };
    return placeOrder(order);
  }

  const message = await model
    .bindTools([requestQuoteTool], { tool_choice: "request_quote" })
    .invoke(`Call request_quote with the right arguments for this email.\n\n${email}`);
  const call = message.tool_calls?.[0];
  if (!call) throw new Error("model did not call request_quote");
  const result = await requestQuoteTool.invoke(call);
  return String(result.content);
}

const orderEmail = `From: dana.reyes@acme-robotics.com
Subject: PO for actuators

Hi — Dana Reyes at Acme Robotics here. We need 12 CX-3 linear actuators and
4 mounting kits shipped to our plant at 500 Harbor Blvd, Oakland, 94607.
We must have them on site by September 30, 2026 — rush it if you have to.

Thanks, Dana`;

const quoteEmail = `From: priya@northwind-labs.io
Subject: quote?

Hello — could you put together a quote for roughly 200 units of the M8
temperature sensor bundle?

Best, Priya Sharma`;

console.log(await triageEmail(orderEmail));
console.log(await triageEmail(quoteEmail));
