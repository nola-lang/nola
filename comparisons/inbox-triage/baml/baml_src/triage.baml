// The domain model, re-declared in BAML's own type system. The generated
// TypeScript types in baml_client/types.ts become the source of truth the
// rest of the app has to import.

class Customer {
  name string
  company string?
}

class Address {
  street string
  city string
  zip string
}

class LineItem {
  description string
  quantity int
}

enum Priority {
  Standard
  Rush
}

class OrderRequest {
  customer Customer
  shipTo Address
  items LineItem[]
  needBy string? @description("requested delivery date as an ISO 8601 date, if the email names one")
  priority Priority
}

enum EmailKind {
  Order
  Quote
}

function ClassifyEmail(email: string) -> EmailKind {
  client Default
  prompt #"
    Is this email placing an order or asking for a quote?

    {{ ctx.output_format }}

    {{ email }}
  "#
}

function ExtractOrder(email: string) -> OrderRequest {
  client Default
  prompt #"
    Extract the order request described in the email.

    {{ ctx.output_format }}

    {{ email }}
  "#
}

// Function calling, BAML-style: a class stands in for the tool's parameters;
// the app dispatches the real call itself after the LLM fills the fields.
class QuoteCall {
  summary string @description("one line describing what the customer wants quoted")
  customerName string @description("the customer's name")
}

function PrepareQuoteCall(email: string) -> QuoteCall {
  client Default
  prompt #"
    Generate the arguments for requesting a quote from this email.

    {{ ctx.output_format }}

    {{ email }}
  "#
}
