import { mockProvider } from "@nola-lang/providers";
import { defineConfig } from "@nola-lang/runtime";

export default defineConfig({
  // Deterministic offline default: the example runs without an API key.
  // Switch to a real provider once you start editing:
  //   import { openai } from "@nola-lang/providers";
  //   model: openai({ model: "gpt-5-mini" }),   // reads OPENAI_API_KEY
  //
  // A call intent asks for ALL its extractor slots at once, as one object
  // keyed by argument position — arg0 is the first argument, arg1 the second.
  model: mockProvider([
    // fileTicket: one slot (the title); the priority is a plain argument
    { arg0: "Checkout page shows a blank screen after paying" },
    // fileTicketCarefully: both slots
    { arg0: "Checkout blank after payment; charged twice", arg1: 1 },
  ]),
});
