import type { BaseNode } from "@nola-lang/ast";
import type { UnderivableContextTypeMode } from "@nola-lang/core";
import type { CompileResult } from "../types.js";
import { Lowerer } from "./lowerer.js";

export interface LowerOptions {
  underivableContextType?: UnderivableContextTypeMode;
}

export function lower(
  source: string,
  file: string,
  ast: BaseNode,
  displayFile: string = file,
  options: LowerOptions = {},
): CompileResult {
  return new Lowerer(source, file, ast, displayFile, options).run();
}
