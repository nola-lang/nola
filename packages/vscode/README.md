# Nola for VS Code

Language support for [Nola](https://nola.sh) — a TypeScript
superset (`.tsi`) where a configured LLM resolves `` ask ..`prompt` ``
extractors at run time.

## Features

- **Syntax highlighting** for `.tsi`: `infer` / `ask` keywords, extractor
  templates, `ask with <provider>` routing.
- **Diagnostics** — Nola parse errors and TypeScript errors, reported at the
  original `.tsi` positions.
- **Hover, completion, go-to-definition** inside `.tsi` files.
  Prompt templates included: typing `${.` inside an instruction (marker,
  extractor, call hint) completes the prompt-scope members, and TS errors
  inside the template point at the exact source range.
- **Plain TypeScript interop** — `.ts` files that import `.tsi` modules get
  full types; go-to-definition from `.ts` lands on the original
  `infer function` (via a bundled tsserver plugin).
- **Debugging** — the "Nola: Launch File" configuration snippet runs a `.tsi`
  entry under the Nola loader; breakpoints bind in `.tsi` source, stepping
  into an infer function works, and debug hover evaluates `..`-contextual
  parameters.

## Getting started

The extension expects a project using the `nola-lang` toolchain:

```bash
npm create nola@latest my-app
```

The scaffold's editor step writes `.vscode/launch.json` (the debug
configuration) and recommends this extension. In an existing project, run
`npx nola init` and pick VS Code at the editor step.

For the language server and tsserver plugin to see your types, keep `.tsi`
files inside a directory-style tsconfig `include` (the scaffold's `["src"]`
already does).

## Debugging

Add the **Nola: Launch File** snippet from "Add Configuration…" in
`launch.json`, or use the one the scaffold wrote. It runs
`node --import nola-lang/register` with source maps wired so breakpoints and
stepping stay in `.tsi` source.

## License

[Apache-2.0](https://github.com/nola-lang/nola/blob/main/LICENSE)
