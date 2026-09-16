// The tsserver plugin: one Volar language-service plugin wrapping the nola
// language plugin, plus the host decorations the editor path needs. Headless
// building blocks (tests and the LSP server compose them by hand):
// createLanguageServicePlugin (Volar quickstart), createProxyLanguageService(ls)
// -> { initialize(language), proxy }, decorateLanguageServiceHost,
// decorateHostWithViews, decorateHostHideShadowedDeclarations,
// decorateLanguageServiceWithDerivationDiagnostics.
import { useTypeScript } from "@nola-lang/derive";
import { createNolaLanguagePlugin } from "@nola-lang/language-core";
import { findProjectRoot } from "@nola-lang/node-loader/project-root";
import type { Language } from "@volar/language-core";
import { createLanguageServicePlugin } from "@volar/typescript/lib/quickstart/createLanguageServicePlugin.js";
import type ts from "typescript";
import { decorateLanguageServiceWithDerivationDiagnostics } from "./derivation-diagnostics.js";
import { guardProjectServiceDocumentCache } from "./document-cache-guard.js";
import { decorateHostForTsiResolutionWatch } from "./resolution-watch.js";
import { decorateServerHostForViews } from "./server-host.js";
import { decorateHostHideShadowedDeclarations } from "./shadowed-declarations.js";
import { decorateHostWithViews } from "./view-host.js";

export function createNolaTsPlugin(): ts.server.PluginModuleFactory {
  return createLanguageServicePlugin((typescript, info) => {
    // derive walks tsserver's own programs: it must use the TypeScript tsserver
    // hands us, and the bundle ships none of its own (typescript is external).
    useTypeScript(typescript);
    const sourceRoot = findProjectRoot(info.project.getCurrentDirectory());
    guardProjectServiceDocumentCache((info.project as unknown as { projectService: unknown }).projectService);
    decorateServerHostForViews(info.serverHost);
    decorateHostHideShadowedDeclarations(typescript, info.languageServiceHost);
    // Here `info.languageService` is still the INNER service (Volar swaps in
    // its mapping proxy after this callback returns), so the lazy derivation
    // diagnostics ride generated offsets and get mapped like TypeScript's own.
    let language: Language<string> | undefined;
    decorateLanguageServiceWithDerivationDiagnostics(typescript, info.languageService, () => language, { sourceRoot });
    return {
      languagePlugins: [createNolaLanguagePlugin<string>((fileName) => fileName, { sourceRoot })],
      // setup runs AFTER Volar's decorateLanguageServiceHost: the view host
      // wraps the resolver that actually handles `.tsi` literals and answers
      // only its misses (the view of a plain module); the resolution watch
      // wraps that in turn, so a revived `.tsi` still invalidates importers.
      setup: (lang) => {
        language = lang;
        decorateHostWithViews(typescript, info.languageServiceHost, { sourceRoot });
        decorateHostForTsiResolutionWatch(info.languageServiceHost, info.serverHost, info.project, [".tsi"]);
      },
    };
  });
}
