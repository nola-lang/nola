# Changelog

## Unreleased

- Snippets for `.tsi`, one per Nola construct. `infer` / `inferc` / `inferi`
  declare an infer function (bare, with a `..`-contextual parameter, or with an
  instruction); `ask` / `askfree` / `askwith` resolve a typed extractor, an
  untyped one, or one routed through a named provider; `calli` writes a call
  intent and `extract` a bare extractor. The `infer` and `ask` prefixes each
  surface their whole family, so there is nothing extra to memorize.

## 0.1.0

Initial Marketplace release.

- Syntax highlighting for `.tsi` (Nola) files, including the `infer` / `ask`
  keywords, extractor templates, and `ask with <provider>` routing.
- Nola language server: diagnostics (Nola-native and TypeScript, mapped back to
  `.tsi` positions), hover, completion, and go-to-definition inside `.tsi`.
- tsserver plugin: plain `.ts` files resolve `.tsi` imports with full types;
  go-to-definition from `.ts` lands on the original `infer function`.
- Debugging: "Nola: Launch File" launch snippet, breakpoints in `.tsi` source,
  stepping into infer functions, and debug hover for `..`-contextual parameters.
