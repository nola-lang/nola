import { extractInvoice } from "./invoice.tsi";

const result = await extractInvoice(
  "INVOICE #INV-2042 issued to LoJell Inc. Due 2026-08-01. Items: 3 x widget @ $19.99 each; 1 x gizmo @ $250.00. Total: $309.97.",
);
console.log(JSON.stringify(result));
