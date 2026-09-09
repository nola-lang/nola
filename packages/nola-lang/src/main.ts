#!/usr/bin/env node
import { NOLA_VERSION } from "@nola-lang/runtime";
import { dispatch } from "create-nola-lang";
import { COMMANDS } from "./commands.js";

dispatch(process.argv.slice(2), COMMANDS, { name: "nola", version: NOLA_VERSION }).then(
  (code) => process.exit(code),
  (err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  },
);
