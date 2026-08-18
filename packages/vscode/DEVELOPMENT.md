# Developing the Nola VS Code extension

The Nola editor experience: syntax highlighting for `.tsi`, the Nola language
server (diagnostics, hover, completion, go-to-definition inside `.tsi`), and
the tsserver plugin that makes plain `.ts` files understand `.tsi` imports.

## Running it

```bash
npm install
npm run build       # builds all packages + the three CJS bundles
```

Then press **F5** ("Run Nola Extension") — an Extension Development Host opens
on `examples/cross-file-types`.

## Packaging for the Marketplace

```bash
npm run build
npm run package -w nola-vscode   # writes nola-vscode-<version>.vsix
```

`scripts/package.mjs` stages a self-contained layout (extension bundle, the
copied LSP server, and the tsserver plugin under `node_modules/`) and runs
`vsce package` — see the script's comments for why dependency mode is
load-bearing. Publish with `npx vsce publish --packagePath <vsix>` (publisher
`nola`; needs a Marketplace PAT).

The extension's version is NOT lockstep (the Marketplace rejects prerelease
suffixes) — bump it by hand in `packages/vscode/package.json`;
`test/publish-manifests.test.ts` pins the plain `x.y.z` shape.

## Manual smoke checklist

Run through this in the F5 host over `examples/cross-file-types` after
substantive editor-layer changes (automated coverage lives in
`test/e2e/editor-lsp.test.ts`; this checks the real-VS-Code seams the tests
can't):

1. Open `src/report.tsi` — syntax highlighting; no squiggles on a clean file.
   Highlighting to eyeball (the injection grammar,
   `language/nola.injection.tmLanguage.json`): `infer` colors like `async` and
   `ask` like `await`; an infer function's `` `instruction` `` reads as a
   string, not as part of the function name; an extractor's `<T>` colors like
   the `<T>` in `class User<T>`; in `ask with <alias>`, `with` colors like
   `ask` and the alias like an enum member (try a keyword alias — `ask with
   default` — since those are legal config keys).
2. Type `const x = ..5;` — a nola-native error (NOLA1005) appears; delete it.
3. Change the ask to `<number>` and assign to a `string` — TS2322 squiggle on
   the right line; undo.
4. Hover `person` — shows `Person`.
5. Type `person.` inside the function — completion offers `name`, `home`,
   `manager`.
6. F12 on `Person` in the import line — lands in `models.ts`.
7. Open `src/main.ts` — `p` is typed `Person`; F12 on `extractPerson` lands in
   `report.tsi` (this one exercises the tsserver plugin, not the LSP).
8. In `models.ts`, add a field to `Person` WITHOUT saving — `main.ts` and
   `report.tsi` pick it up (companion freshness).
9. Break `report.tsi` mid-template (delete the closing backtick) — `main.ts`
   keeps its types (last-good) and `report.tsi` shows the parse error.
10. Debugging: open `examples/_playground`, "Add Configuration…" in a new
    `launch.json` offers **Nola: Launch File**; set a breakpoint on an `ask`
    line in `src/test_3/classify.tsi`, F5 the playground's "Nola: Launch main"
    config — the breakpoint binds (solid red), execution stops there, and
    stepping/variables work in `.tsi` source.
11. Snippets (`language/nola.snippets.json`). In `report.tsi`, type `infer` at
    top level — all three infer snippets appear alongside the language
    server's completions, and accepting **Infer function** expands with the tab
    stops on the name and the params. Inside the function, type `ask` — the
    three ask snippets appear. Snippets are a VS Code-native completion source
    rather than an LSP one, so this checks the two lists coexist; the bodies
    themselves are parse-checked in `test/snippets.test.ts`.

## Installed-VSIX smoke (before a Marketplace publish)

The F5 host resolves through the monorepo's hoisted node_modules; an installed
VSIX must stand alone. After `npm run package`, install the `.vsix` via
"Install from VSIX…" in a window whose workspace is OUTSIDE this repo (e.g. a
fresh `npm create nola-lang` scaffold) and re-run items 1–7 and 10 above —
that exercises the copied `dist/server.cjs`, the workspace-or-builtin tsdk
fallback, and the plugin under the extension's own `node_modules`.
