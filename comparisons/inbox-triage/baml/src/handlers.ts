// Handlers are typed against the GENERATED client types — after adopting
// BAML, the domain model lives in baml_src/ and TypeScript consumes what
// codegen emits.
import type { OrderRequest } from "../baml_client/types.js";

export function placeOrder(order: OrderRequest): string {
  const units = order.items.reduce((n, item) => n + item.quantity, 0);
  // needBy is a plain string in BAML — revive it by hand.
  const due = order.needBy ? ` by ${new Date(order.needBy).toDateString()}` : "";
  return `ORDER PLACED: ${units} units for ${order.customer.name} → ${order.shipTo.city} ${order.shipTo.zip}${due} [${order.priority.toLowerCase()}]`;
}

export function requestQuote(summary: string, customerName: string): string {
  return `QUOTE QUEUED for ${customerName}: ${summary}`;
}
