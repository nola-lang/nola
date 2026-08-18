import type { LanguagePlugin } from "@volar/language-core";
// Side-effect type import: @volar/typescript's module augmentation declares
// LanguagePlugin.typescript (extraFileExtensions/getServiceScript).
import type {} from "@volar/typescript";
import { discoverCompilerConfig, type EditorCompilerConfig } from "./compiler-config.js";
import { NolaVirtualCode } from "./virtual-code.js";

export interface NolaLanguagePluginOptions {
  /** project root for display paths in emitted code (findProjectRoot at the host) */
  sourceRoot?: string;
  /**
   * Compile-relevant config for a script. Default: static nola.config.ts
   * discovery on disk (discoverCompilerConfig). Override for tests or hosts
   * with their own config channel.
   */
  compilerConfig?: (fileName: string) => EditorCompilerConfig;
}

/**
 * Generic over the script id (tsserver uses fileName strings, an LSP host uses
 * URIs) — the Vue pattern. language-core stays transport-free.
 */
export function createNolaLanguagePlugin<T>(
  asFileName: (scriptId: T) => string,
  options: NolaLanguagePluginOptions = {},
): LanguagePlugin<T, NolaVirtualCode> {
  return {
    getLanguageId(scriptId) {
      if (asFileName(scriptId).endsWith(".tsi")) return "nola";
      return undefined;
    },
    createVirtualCode(scriptId, languageId, snapshot) {
      if (languageId !== "nola") return undefined;
      const compilerConfig = options.compilerConfig ?? discoverCompilerConfig;
      return new NolaVirtualCode(snapshot, asFileName(scriptId), options.sourceRoot, compilerConfig);
    },
    updateVirtualCode(_scriptId, code, snapshot) {
      code.update(snapshot);
      return code;
    },
    typescript: {
      // scriptKind MUST be 7 (Deferred): TypeScript's getSupportedExtensions
      // only honors extra extensions whose scriptKind is Deferred, so a .tsi
      // matched by a tsconfig include joins the configured project. The
      // SERVICE script below is still TS — Deferred means "the plugin decides".
      extraFileExtensions: [{ extension: "tsi", isMixedContent: false, scriptKind: 7 }],
      getServiceScript(root) {
        // The augmentation types root as the base VirtualCode; ours always is a NolaVirtualCode.
        if (!(root instanceof NolaVirtualCode)) return undefined;
        return { code: root.embeddedCodes[0], extension: ".ts", scriptKind: 3 };
      },
    },
  };
}
