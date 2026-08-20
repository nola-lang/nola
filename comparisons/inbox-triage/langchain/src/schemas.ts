// The zod mirror of src/types.ts — every field re-declared a second time so
// the model has a wire schema. Types and schemas now have to be kept in sync
// by hand; a drift is invisible until runtime.
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

// withStructuredOutput needs an object at the root, so the classification
// label gets a wrapper.
export const EmailKindSchema = z.object({
  kind: z.enum(["order", "quote"]),
});
