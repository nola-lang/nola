import { greet } from "./greet.tsi";

greet("Ada").then((answer) => {
  console.log(JSON.stringify({ answer }));
});
