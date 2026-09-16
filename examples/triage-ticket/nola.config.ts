import { typesafe } from "@nola-lang/providers";
import { defineConfig } from "@nola-lang/runtime";

export default defineConfig({
  // typesafe.ai's Jev is not a chat model: it answers typed questions — literal
  // unions and booleans — about the ticket with calibrated probabilities. The
  // factory turns the ask's output type into those questions; anything it
  // cannot serve (free text, numbers, arrays) fails before the network.
  // Reads TYPESAFE_API_KEY from the environment (the project .env) at the first ask.
  model: typesafe(),
  // Offline alternative while developing:
  //   import { mockProvider } from "@nola-lang/providers";
  //   model: mockProvider([{ department: "billing", urgent: true, priority: 3, refundRequested: true }]),
});
