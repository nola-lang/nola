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
12. Context statements. Set up as in item 10 (`examples/_playground`, the
    "Nola: Launch main" config). In `src/test_3/classify.tsi`, add these
    lines just before the `return`:

    ```
    const seen: string[] = [];
    for (const n of [1, 2, 3]) {
      `Steps so far:` seen;
      seen.push(ask `the next step ${n}`: string);
    }
    ```

    Put a breakpoint on the `` `Steps so far:` `` line and F5. It binds (solid
    red) at the statement itself and pauses once per loop pass, before the ask
    on the next line renders the item: the statement is a line like any other,
    so F10 walks on to the ask, and a step over the ask never enters the item.
    The Variables pane shows `seen` one entry longer each pass, which is the
    text the item will put into the prompt. Stepping stays in the `.tsi`.

    Then the module-body shape: make a file's FIRST line a context statement
    at column 0 (`` `You are a request solver.`; `` above a top-level ask) and
    put a breakpoint on it. It binds at line 1, pauses there at program start
    displaying the `.tsi`, and F10 steps to the next statement in source
    order. Before 2026-09-29 the breakpoint resolved into the item's hoisted
    function instead: the pause came mid-ask, in a read-only copy of the
    generated script (the loader dropped the line's map segments as if it
    were an infer-wrapper line), and F10 toured the other items as the
    runtime rendered them. `transform.test.ts` pins the line's map; the
    `contextItemOpen` comment in the compiler's templates.ts explains the
    `void` read that gives the statement its step location.

## Scaffolding against the workspace build

Set `NOLA_LINK_CHECKOUT` to this checkout's root (the folder holding
`packages/`), then run `nola init` anywhere — from an `npm link`ed CLI or one
installed from the packages — and accept "Install dependencies and open VS
Code?". The scaffold is what a user gets (its `package.json` pins the
published range), but after the install the flow relinks `@nola-lang/runtime`,
`@nola-lang/providers` and `nola-lang` in the new project's `node_modules` to
that checkout's `packages/*` and says so in the outro. `npm run build` first —
the links point at `dist/`. A later `npm install` in that project restores the
npm copies (re-run `nola init` over it, or relink by hand).

## Installed-VSIX smoke (before a Marketplace publish)

The F5 host resolves through the monorepo's hoisted node_modules; an installed
VSIX must stand alone. After `npm run package`, install the `.vsix` via
"Install from VSIX…" in a window whose workspace is OUTSIDE this repo (e.g. a
fresh `npm create nola` scaffold) and re-run items 1–7 and 10 above —
that exercises the copied `dist/server.cjs`, the workspace-or-builtin tsdk
fallback, and the plugin under the extension's own `node_modules`.
