# Vendored: VS Code's TypeScript grammar (test fixture)

- Upstream: the `typescript-basics` extension built into VS Code —
  `<install>/resources/app/extensions/typescript-basics/syntaxes/TypeScript.tmLanguage.json`,
  itself generated from https://github.com/microsoft/TypeScript-TmLanguage (MIT, Copyright (c)
  Microsoft Corporation); the file's own `version` field names the upstream commit.
- Where: `TypeScript.tmLanguage.json` beside this note, byte-identical to the copy in VS Code
  1.141.0.
- Date vendored: 2026-10-09.
- Why: `grammar.test.ts` tokenizes `.tsi` source through vscode-textmate the way the editor
  does, and the Nola grammars only mean something next to `source.ts` — every type, name and
  bracket they scope comes from TypeScript's rules. The editor's own copy is the one that matters,
  so the test runs that copy rather than a registry package (`tm-grammars` ships 12 MB of grammars
  for this one file).
- Not shipped: `scripts/package.mjs` stages `language/` and `media/` into the VSIX, never `test/`.
- Refresh: copy the file from a current VS Code install, update the version above, and run
  `npx vitest run packages/vscode/test/grammar.test.ts`.
