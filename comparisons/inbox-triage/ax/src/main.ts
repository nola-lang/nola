import { ai } from "@ax-llm/ax";
import { placeOrder, requestQuote } from "./handlers.js";
import { classifier, orderExtractor, quoteArgsExtractor } from "./signatures.js";
import type { OrderRequest } from "./types.js";

const llm = ai({ name: "openai", apiKey: process.env.OPENAI_API_KEY ?? "" });

async function triageEmail(emailText: string): Promise<string> {
  const { kind } = await classifier.forward(llm, { emailText });

  if (kind === "order") {
    const { order } = await orderExtractor.forward(llm, { emailText });
    // Ax infers its own result type from the signature string — including a real
    // Date for `needBy` — and today that shape lines up with OrderRequest. But
    // the two are declared independently: rename a field in types.ts and this
    // assignment is the only thing that notices, if it notices at all.
    const domainOrder: OrderRequest = order;
    return placeOrder(domainOrder);
  }

  const { summary, customerName } = await quoteArgsExtractor.forward(llm, { emailText });
  return requestQuote(summary, customerName);
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
