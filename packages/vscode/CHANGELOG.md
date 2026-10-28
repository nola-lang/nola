# Changelog

## Unreleased

- The type after a bare value in an ask — `` `use this config` searchConfig:
  string[] `` — reads as a type annotation, on the value's line or the next
  (`string` colored like a variable); a value on a line of its own is still
  TypeScript's. A comment between two parts of an ask — a commented-out
  part on its own line, or a comment trailing a text, a list or a value —
  no longer ends the coloring of the parts after it.
- Format Document lays an ask out as an ask, not as the tagged templates and
  index TypeScript read it as: one space between the parts on a line, the
  `: T` glued, a part or the type on its own line indented one level from
  the ask's line, a tool list's entries two (it deleted the space between a
  text and a list and dedented a list on its own line).
- An ask laid out one part per line — the tool list on the line after the
  text, the type on the line after the text or the list — colors its list
  and type as on one line (`string` in a type on its own line colored like
  a variable).
- The type after an extractor's tool list — `` ask `p` [searchFiles,
  readFile]: string[] `` or `` ]<string[]> `` — reads as a type annotation
  (it colored like a variable); the list keeps TypeScript's coloring for
  its names and may span lines.
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
