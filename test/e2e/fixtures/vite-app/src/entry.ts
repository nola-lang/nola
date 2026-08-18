import { greet } from "./greet.tsi";

console.log(JSON.stringify({ answer: await greet("Ada") }));
