import OpenAI from "openai";
import { zodResponsesFunction, zodTextFormat } from "openai/helpers/zod";
import { placeOrder, requestQuote } from "./handlers.js";
import { EmailKindSchema, OrderRequestSchema, QuoteArgsSchema } from "./schemas.js";
import type { OrderRequest } from "./types.js";

const client = new OpenAI();
const model = "gpt-5-mini";

const quoteTool = zodResponsesFunction({
  name: "request_quote",
  description: "Queue a quote request for a customer",
  parameters: QuoteArgsSchema,
});

async function triageEmail(email: string): Promise<string> {
  const classification = await client.responses.parse({
    model,
    input: [{ role: "user", content: `Is this email placing an order or asking for a quote?\n\n${email}` }],
    text: { format: zodTextFormat(EmailKindSchema, "email_kind") },
  });
  if (!classification.output_parsed) throw new Error("no classification returned");

  if (classification.output_parsed.kind === "order") {
    const extraction = await client.responses.parse({
      model,
      input: [{ role: "user", content: `Extract the order request described in the email.\n\n${email}` }],
      text: { format: zodTextFormat(OrderRequestSchema, "order_request") },
    });
    const raw = extraction.output_parsed;
    if (!raw) throw new Error("no order returned");
    // Two bridges back to the domain type: revive the date, and turn the
    // strict-mode nulls back into the optional fields OrderRequest declares.
    const order: OrderRequest = {
      customer: {
        name: raw.customer.name,
        company: raw.customer.company ?? undefined,
      },
      shipTo: raw.shipTo,
      items: raw.items,
      needBy: raw.needBy ? new Date(raw.needBy) : undefined,
      priority: raw.priority,
    };
    return placeOrder(order);
  }

  const call = await client.responses.parse({
    model,
    input: [{ role: "user", content: `Call request_quote with the right arguments for this email.\n\n${email}` }],
    tools: [quoteTool],
    tool_choice: { type: "function", name: "request_quote" },
  });
  const fnCall = call.output.find((item) => item.type === "function_call");
  if (!fnCall?.parsed_arguments) throw new Error("model did not call request_quote");
  const args = fnCall.parsed_arguments as { summary: string; customerName: string };
  return requestQuote(args.summary, args.customerName);
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
