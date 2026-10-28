import { expect, test } from "bun:test";
import { describe } from "./src/describe.tsi";

test("a .tsi module loads under bun test through the [test] preload, configured from nola.config.ts", async () => {
  expect(await describe("Ada")).toBe("a poet");
});
