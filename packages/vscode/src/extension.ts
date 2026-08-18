import { existsSync } from "node:fs";
import * as vscode from "vscode";
import { LanguageClient, TransportKind } from "vscode-languageclient/node";
import { evaluatableRange } from "./evaluatable-expression.js";
import { resolveTsdk } from "./tsdk.js";

let client: LanguageClient | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  // Debug hover: VS Code's built-in expression fallback extracts `.address`
  // for a contextual parameter (dots read as property access), which fails to
  // evaluate and shows nothing. See evaluatable-expression.ts.
  context.subscriptions.push(
    vscode.languages.registerEvaluatableExpressionProvider("nola", {
      provideEvaluatableExpression(document, position) {
        const wordRange = document.getWordRangeAtPosition(position);
        if (!wordRange || wordRange.start.line !== wordRange.end.line) return undefined;
        const line = document.lineAt(wordRange.start.line).text;
        const range = evaluatableRange(line, wordRange.start.character, wordRange.end.character);
        if (!range) return undefined;
        return new vscode.EvaluatableExpression(
          new vscode.Range(wordRange.start.line, range.start, wordRange.start.line, range.end),
        );
      },
    }),
  );

  // bundle.mjs copies the LSP server next to the extension bundle — an
  // installed VSIX has no node_modules to resolve it from.
  const serverModule = context.asAbsolutePath("dist/server.cjs");
  // The tsdk the server loads — the workspace's TypeScript when it has one
  // (parity with the tsserver plugin under enableForWorkspaceTypeScriptVersions),
  // else the TypeScript VS Code ships.
  const tsdk = resolveTsdk({
    workspaceFolders: (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath),
    appRoot: vscode.env.appRoot,
    exists: existsSync,
  });
  if (!tsdk) {
    void vscode.window.showErrorMessage("Nola: no TypeScript found (workspace or VS Code built-in); the language server was not started.");
    return;
  }

  client = new LanguageClient(
    "nola",
    "Nola Language Server",
    {
      run: { module: serverModule, transport: TransportKind.ipc },
      debug: { module: serverModule, transport: TransportKind.ipc, options: { execArgv: ["--inspect=6039"] } },
    },
    {
      documentSelector: [{ language: "nola" }],
      initializationOptions: { typescript: { tsdk } },
    },
  );
  await client.start();
}

export async function deactivate(): Promise<void> {
  await client?.stop();
  client = undefined;
}
