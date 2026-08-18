// Installed-API findings (@volar/language-server@2.4.28), per plan Task 1 Step 1:
// - node entry: createConnection() / createServer(connection) /
//   createTypeScriptProject(ts, tsLocalized, create) / loadTsdkByPath(tsdk, locale).
// - create(projectContext) returns { languagePlugins: LanguagePlugin<URI>[],
//   setup?({ language, project }) } — project is ProjectContext, whose
//   `typescript.languageServiceHost` (augmented by @volar/typescript) is where
//   companions decorate.
// - volar-service-typescript: create(ts) -> LanguageServicePlugin[].
import { createNolaLanguagePlugin } from "@nola-lang/language-core";
import { findProjectRoot } from "@nola-lang/node-loader";
import { decorateHostHideShadowedDeclarations, decorateHostWithCompanions } from "@nola-lang/typescript-plugin";
import {
  createConnection,
  createServer,
  createTypeScriptProject,
  loadTsdkByPath,
} from "@volar/language-server/node.js";
import { create as createTypeScriptServices } from "volar-service-typescript";
import type { URI } from "vscode-uri";
import { createNolaServicePlugin } from "./nola-service.js";

const connection = createConnection();
const server = createServer(connection);

connection.listen();

connection.onInitialize((params) => {
  const tsdkPath = (params.initializationOptions as { typescript?: { tsdk?: string } } | undefined)?.typescript?.tsdk;
  if (!tsdkPath) {
    throw new Error("initializationOptions.typescript.tsdk is required (path to a typescript/lib directory)");
  }
  const tsdk = loadTsdkByPath(tsdkPath, params.locale);
  const rootDir = server.workspaceFolders.all[0]?.fsPath ?? process.cwd();
  const sourceRoot = findProjectRoot(rootDir);

  return server.initialize(
    params,
    createTypeScriptProject(tsdk.typescript, tsdk.diagnosticMessages, () => ({
      languagePlugins: [createNolaLanguagePlugin<URI>((uri) => uri.fsPath.replace(/\\/g, "/"), { sourceRoot })],
      setup({ project }) {
        const host = project.typescript?.languageServiceHost;
        if (host) {
          decorateHostHideShadowedDeclarations(tsdk.typescript, host);
          decorateHostWithCompanions(tsdk.typescript, host, { sourceRoot });
        }
      },
    })),
    [...createTypeScriptServices(tsdk.typescript), createNolaServicePlugin(tsdk.typescript)],
  );
});

connection.onInitialized(server.initialized);
connection.onShutdown(server.shutdown);
