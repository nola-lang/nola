import { greet } from "../../../src/greet.tsi";

export async function GET(): Promise<Response> {
  return Response.json({ answer: await greet("Ada") });
}
