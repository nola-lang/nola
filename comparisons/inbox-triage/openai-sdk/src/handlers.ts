import type { OrderRequest } from "./types.js";

export function placeOrder(order: OrderRequest): string {
  const units = order.items.reduce((n, item) => n + item.quantity, 0);
  const due = order.needBy ? ` by ${order.needBy.toDateString()}` : "";
  return `ORDER PLACED: ${units} units for ${order.customer.name} → ${order.shipTo.city} ${order.shipTo.zip}${due} [${order.priority}]`;
}

export function requestQuote(summary: string, customerName: string): string {
  return `QUOTE QUEUED for ${customerName}: ${summary}`;
}
