import { typesafe } from "@nola-lang/providers";
import { defineConfig } from "@nola-lang/runtime";

export default defineConfig({
  // typesafe.ai's Jev is not a chat model: it answers typed questions — literal
  // unions, booleans, and the intrinsic Choice / Scale / Prob decision types —
  // about the ticket with calibrated probabilities. The factory turns the ask's
  // output type into those questions and the `const .ticket` binding into the
  // request's state; anything it cannot serve (free text, numbers, arrays)
  // fails before the network.
  // Reads TYPESAFE_API_KEY from the environment (the project .env) at the first ask.
  model: typesafe(),
  // Offline alternative while developing:
  //   import { mockProvider } from "@nola-lang/providers";
  //   model: mockProvider([{ department: "billing", urgent: true, priority: 3, refundRequested: true }]),
});
