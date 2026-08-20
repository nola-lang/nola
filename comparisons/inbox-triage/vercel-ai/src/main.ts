import { openai } from "@ai-sdk/openai";
import { generateObject, generateText, tool } from "ai";
import * as z from "zod";
import { placeOrder, requestQuote } from "./handlers.js";
import { OrderRequestSchema } from "./schemas.js";
import type { OrderRequest } from "./types.js";

const model = openai("gpt-5-mini");

const requestQuoteTool = tool({
  description: "Queue a quote request for a customer",
  inputSchema: z.object({
    summary: z.string().describe("one line describing what the customer wants quoted"),
    customerName: z.string().describe("the customer's name"),
  }),
});

async function triageEmail(email: string): Promise<string> {
  const { object: kind } = await generateObject({
    model,
    output: "enum",
    enum: ["order", "quote"],
    prompt: `Is this email placing an order or asking for a quote?\n\n${email}`,
  });

  if (kind === "order") {
    const { object: raw } = await generateObject({
      model,
      schema: OrderRequestSchema,
      prompt: `Extract the order request described in the email.\n\n${email}`,
    });
    // needBy crosses the wire as a string; the domain type wants a Date.
    const order: OrderRequest = {
      ...raw,
      needBy: raw.needBy ? new Date(raw.needBy) : undefined,
    };
    return placeOrder(order);
  }

  const { staticToolCalls } = await generateText({
    model,
    tools: { request_quote: requestQuoteTool },
    toolChoice: "required",
    prompt: `Call request_quote with the right arguments for this email.\n\n${email}`,
  });
  const call = staticToolCalls[0];
  if (call?.toolName !== "request_quote") throw new Error("model did not call request_quote");
  return requestQuote(call.input.summary, call.input.customerName);
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
