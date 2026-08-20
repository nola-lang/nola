// The zod mirror of src/types.ts. Same fields, second declaration — the AI SDK
// needs a runtime schema and TypeScript interfaces are erased at compile time.
import * as z from "zod";

export const CustomerSchema = z.object({
  name: z.string(),
  company: z.string().optional(),
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
    .describe("requested delivery date as an ISO 8601 date, if the email names one")
    .optional(),
  priority: z.enum(["standard", "rush"]),
});
