import { parseTree } from "./tree.tsi";

const result = await parseTree(
  "a filesystem root containing a src folder with main.ts inside, and an empty docs folder",
);
console.log(JSON.stringify(result));
