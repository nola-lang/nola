import { solve } from "./solve.tsi";

const result = await solve(
  "Roger has 5 tennis balls. He buys 2 more cans of tennis balls. Each can has 3 tennis balls. How many tennis balls does he have now?",
);
console.log(JSON.stringify(result));
