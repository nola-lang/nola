// The zod mirror of src/types.ts — plus one extra rule the other stacks don't
// impose: OpenAI's strict Structured Outputs requires every key to be present
// in `required`, so an optional field has to be spelled `.nullable()` and
// mapped back to `undefined` afterwards.
import * as z from "zod";

export const CustomerSchema = z.object({
  name: z.string(),
  company: z.string().nullable(),
});

export const AddressSchema = z.object({
  street: z.string(),
  city: z.string(),
  zip: z.string(),
});

export const LineItemSchema = z.object({
  description: z.string(),
  quantity: z.number().int(),
});

export const OrderRequestSchema = z.object({
  customer: CustomerSchema,
  shipTo: AddressSchema,
  items: z.array(LineItemSchema),
  needBy: z
    .string()
    .describe("requested delivery date as an ISO 8601 date, or null if the email names none")
    .nullable(),
  priority: z.enum(["standard", "rush"]),
});

export const EmailKindSchema = z.object({
  kind: z.enum(["order", "quote"]),
});

export const QuoteArgsSchema = z.object({
  summary: z.string().describe("one line describing what the customer wants quoted"),
  customerName: z.string().describe("the customer's name"),
});
