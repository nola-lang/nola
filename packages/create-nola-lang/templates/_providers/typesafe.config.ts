import { typesafe } from "@nola-lang/providers";
import { defineConfig } from "@nola-lang/runtime";

export default defineConfig({
  // typesafe.ai's Jev is not a chat model: it answers typed questions — literal
  // unions and booleans — about the input with calibrated probabilities. The
  // factory turns the ask's output type into those questions; anything it
  // cannot serve (free text, numbers, arrays, nested objects) fails before the
  // network with an error naming the property.
  // Reads TYPESAFE_API_KEY from the environment (the project .env) at the first ask.
  model: typesafe(),
  // Serve the asks typesafe.ai cannot with a general model instead:
  //   import { fallback, openai, typesafe } from "@nola-lang/providers";
  //   model: fallback([typesafe(), openai("gpt-5-mini")]),
  // Offline alternative while developing:
  //   import { mockProvider } from "@nola-lang/providers";
  //   model: mockProvider([{ hello: "world" }]),
});
