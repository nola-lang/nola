import { b } from "../baml_client/index.js";
import { EmailKind } from "../baml_client/types.js";
import { placeOrder, requestQuote } from "./handlers.js";

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

async function triageEmail(email: string): Promise<string> {
  const kind = await b.ClassifyEmail(email);
  if (kind === EmailKind.Order) {
    const order = await b.ExtractOrder(email);
    return placeOrder(order);
  }
  const call = await b.PrepareQuoteCall(email);
  return requestQuote(call.summary, call.customerName);
}

console.log(await triageEmail(orderEmail));
console.log(await triageEmail(quoteEmail));
