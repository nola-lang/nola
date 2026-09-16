import type ts from "typescript";
import { TS } from "./ts.js";

export interface ProjectConfig {
  options: ts.CompilerOptions;
  fileNames: string[];
  /** set when the tsconfig could not be read; derivation proceeds with the defaults */
  warning?: string;
}

/**
 * The compiler options the derivation program runs with: the nearest tsconfig
 * (searched upward from `projectRoot`) or, without one, strict NodeNext
 * defaults. An unreadable tsconfig is not fatal — `tsc` fails for the user
 * anyway — so the defaults apply and the caller prints one warning.
 */
export function readTsconfig(projectRoot: string): ProjectConfig {
  const defaults: ts.CompilerOptions = {
    strict: true,
    target: TS.ScriptTarget.ES2022,
    module: TS.ModuleKind.NodeNext,
    moduleResolution: TS.ModuleResolutionKind.NodeNext,
    skipLibCheck: true,
    noEmit: true,
    allowArbitraryExtensions: true,
  };
  const path = TS.findConfigFile(projectRoot, TS.sys.fileExists);
  if (!path) return { options: defaults, fileNames: [] };
  const read = TS.readConfigFile(path, TS.sys.readFile);
  if (read.error) {
    return {
      options: defaults,
      fileNames: [],
      warning: `${path}: ${TS.flattenDiagnosticMessageText(read.error.messageText, " ")} — deriving with default options`,
    };
  }
  const parsed = TS.parseJsonConfigFileContent(read.config, TS.sys, projectRoot.replace(/\\/g, "/"));
  return {
    options: { ...parsed.options, noEmit: true, allowArbitraryExtensions: true },
    // stale adjacent declarations of a live .tsi must not shadow the lowered virtual
    fileNames: parsed.fileNames.filter((f) => !/\.d\.tsi\.ts$/.test(f)).map((f) => f.replace(/\\/g, "/")),
  };
}
