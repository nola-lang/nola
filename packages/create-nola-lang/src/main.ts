#!/usr/bin/env node
import { parseArgs } from "node:util";
import { runFlow } from "./flow.js";

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    template: { type: "string" },
    add: { type: "boolean" },
    ide: { type: "string" },
    agents: { type: "string" },
  },
});

try {
  process.exit(
    await runFlow({
      dir: positionals[0],
      template: values.template,
      add: values.add,
      ide: values.ide,
      agents: values.agents,
    }),
  );
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}
