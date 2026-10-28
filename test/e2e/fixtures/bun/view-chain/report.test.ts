import { expect, test } from "bun:test";
import { extractPerson } from "./src/report.tsi";

test("a .tsi whose type reaches a second plain module (a view of a view) loads under bun test", async () => {
  expect(await extractPerson("Ada from London N1")).toEqual({ name: "Ada", home: { city: "London", zip: "N1" } });
});
