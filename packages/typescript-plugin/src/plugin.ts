// Installed-API findings (@volar/typescript@2.4.28), per plan Task 3 Step 1:
// - quickstart factory: `createLanguageServicePlugin(cb)` at
//   lib/quickstart/createLanguageServicePlugin (subpath import; package has no
//   exports map). cb: (ts, info) => { languagePlugins: LanguagePlugin<string>[], setup? }.
// - LanguagePlugin.typescript augmentation lives in @volar/typescript's index.
// - Headless building blocks: createLanguage (@volar/language-core),
//   decorateLanguageServiceHost(ts, language, host) and
//   createProxyLanguageService(ls) -> { initialize(language), proxy } (@volar/typescript).
import { createNolaLanguagePlugin } from "@nola-lang/language-core";
import { findProjectRoot } from "@nola-lang/node-loader";
import { createLanguageServicePlugin } from "@volar/typescript/lib/quickstart/createLanguageServicePlugin.js";
import type ts from "typescript";
import { decorateHostWithCompanions } from "./companion-host.js";
import { guardProjectServiceDocumentCache } from "./document-cache-guard.js";
import { decorateHostForTsiResolutionWatch } from "./resolution-watch.js";
import { decorateServerHostForCompanions } from "./server-host.js";
import { decorateHostHideShadowedDeclarations } from "./shadowed-declarations.js";

/** tsserver plugin factory; loaded via the CJS bundle in Track 3. */
export function createNolaTsPlugin(): ts.server.PluginModuleFactory {
  return createLanguageServicePlugin((typescript, info) => {
    const sourceRoot = findProjectRoot(info.project.getCurrentDirectory());
    guardProjectServiceDocumentCache((info.project as unknown as { projectService: unknown }).projectService);
    decorateServerHostForCompanions(info.serverHost);
    decorateHostHideShadowedDeclarations(typescript, info.languageServiceHost);
    decorateHostWithCompanions(typescript, info.languageServiceHost, { sourceRoot });
    return {
      languagePlugins: [createNolaLanguagePlugin<string>((fileName) => fileName, { sourceRoot })],
      // setup runs AFTER Volar's decorateLanguageServiceHost, so this wraps the
      // resolver that actually handles `.tsi` literals (see resolution-watch.ts).
      setup: () => {
        decorateHostForTsiResolutionWatch(info.languageServiceHost, info.serverHost, info.project, [".tsi"]);
      },
    };
  });
}
