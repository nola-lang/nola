# Nola for VS Code

Language support for [Nola](https://nola.sh) — a **TypeScript superset** where
asking a language model for a typed value is part of the language. Files end in
`.tsi`; everything you know about TypeScript applies inside them, plus two
constructs: `infer function` declares an LLM-backed function, and `ask` resolves
an intent the way `await` resolves a promise. The toolchain *lowers* `.tsi` to
plain TypeScript before `tsc`, bundlers, Node, or your editor ever see it — the
same way JSX is compiled away.

```ts
// analyze.tsi
export infer function analyzeUserRequest(userId: string, .message: string) {
  const ticketId = ask ..`ticket id mentioned in the message`<string>;
  const isFraud = ask ..`does the message look fraudulent`<boolean>;
  return { userId, ticketId, isFraud };
}
```

```ts
// main.ts — plain TypeScript imports the .tsi directly
import { analyzeUserRequest } from "./analyze.tsi";

const result = await analyzeUserRequest("user-1", "Ticket TCK-4711: suspicious activity.");
// → { userId: "user-1", ticketId: "TCK-4711", isFraud: true }
```

`.message` is a *contextual* parameter — its value is shown to the model in every
`ask` of that invocation; `userId` is a plain argument the model never sees. The
TypeScript type *is* the schema: `<boolean>` is validated, and a `Date` comes
back as a real `Date`.

## What the extension gives you

The extension bundles the Nola language server and a tsserver plugin; nothing
needs to be installed globally.

- **Syntax highlighting** for `.tsi`: the `infer` / `ask` keywords, the `..`
  extractor marker with its `` `instruction` `` and `<T>`, an infer function's
  `` `instruction` `` marker, and `ask with <provider>` routing — layered on the
  full TypeScript grammar, so everything else colors as it does in `.ts`.
- **Diagnostics** — Nola parse and compile errors (`NOLA1xxx` / `NOLA2xxx`)
  and TypeScript errors, reported at the original `.tsi` positions.
- **Hover, completion, go-to-definition** inside `.tsi` files — over plain TS,
  infer functions, extractor result types, and provider aliases. Prompt
  templates included: typing `${.` inside an instruction (function marker,
  extractor, call hint) completes the prompt-scope members, and TS errors
  inside a template point at the exact source range.
- **Plain TypeScript interop** — `.ts` files that import `.tsi` modules get
  full types (an infer function is typed as returning `Intent<T>`, so `await`
  gives you `T`), and go-to-definition from `.ts` lands on the original
  `infer function`. Types imported across files resolve live as you edit,
  without saving.
- **Last-good types while you type** — a `.tsi` broken mid-edit shows its parse
  error while files importing it keep the last valid types.
- **Debugging** — the **Nola: Launch File** configuration snippet runs a `.tsi`
  entry under the Nola loader; breakpoints bind in `.tsi` source, one F11 at a
  call site steps into the infer function's body, and debug hover evaluates
  contextual parameters (`.message`) as well as ordinary variables.
- **Snippets** for every construct (below), file icon, and bracket/comment
  configuration for `.tsi`.

## The language at a glance

Everything below is highlighted, type-checked and completable in `.tsi` files.

| Construct | Syntax | Meaning |
|---|---|---|
| **Infer function** | `infer function name(…) { … }` — optionally `` name`instruction`(…) `` | An LLM-backed function, importable from plain TS/JS. Calling it runs nothing; it returns a lazy, thenable `Intent<T>`. `await` is legal in the body for ordinary promises. |
| **Contextual parameter** | `.name: T` | The argument's value joins the prompt of every `ask` in the invocation. Plain parameters contribute name and type only. *One dot in, two dots out.* |
| **Extractor** | `` ..`instruction`<T> `` | A request to pull a `T` from context. Supports `${}` interpolation; may be constructed anywhere; resolved with `ask`. Untyped (`` ..`instruction` ``) yields free text. |
| **`ask` operator** | `ask <intent>` | Resolves an intent the way `await` resolves a promise — same precedence. Legal only directly inside an infer function body; `ask` is a reserved word in `.tsi`. |
| **Model routing** | `ask with <name> <intent>` | Resolves one ask through a named model from `nola.config.ts` (static identifier; `.withModel()` is the dynamic form). |
| **Call intent** | `` fn`hint`(…) `` or a plain call with an extractor argument, `` fn(..`x`<T>, …) `` | The model fills the extractor-shaped arguments, then the function is called; async results are awaited. Only the hint form carries instruction text. |
| **Prompt template** | `${.member}` inside any instruction literal | Reads the intent's prompt scope (`.default`, `.next`, `.type`, `.args`, …); the literal then replaces that intent's built-in prompt block. |
| **Intent methods** | `.withRetry(n)` · `.withModel()` · `.withParams()` · `.withTimeout()` · `.detached()` | Per-intent knobs; each clones the intent. `.detached()` exists only on the `Intent` an infer function returns. |

Typed extractors derive a JSON Schema at compile time from `string`, `number`,
`boolean`, `Date`, arrays, inline object literals, string-literal unions and
string enums, and named aliases/interfaces from the same file or imported from
another (recursive types included); JSDoc comments on members become schema
descriptions. Providers (`openai`, `anthropic`, `google`, `mockProvider`,
record/replay, `withRetry` / `fallback` / `roundRobin`) are configured once in
`nola.config.ts`.

**[The mental model →](https://nola.sh/docs/language/mental-model/)** ·
[Syntax cheatsheet →](https://nola.sh/docs/reference/syntax-cheatsheet/) ·
[Error codes →](https://nola.sh/docs/reference/error-codes/)

## Getting started

The extension expects a project using the `nola-lang` toolchain:

```bash
npm create nola@latest        # new project — prompts for name, template, editor + agent setup
npm create nola -- --add      # retrofit the current project
```

Pick **VS Code** at the editor step (or pass `--ide vscode`) and the scaffold
writes `.vscode/launch.json` (the debug configuration) and
`.vscode/extensions.json` (recommends this extension). In an existing project,
`npx nola-lang init` runs the same flow.

Two things the language server and tsserver plugin need:

- **`.tsi` inside a directory-style tsconfig `include`** — `["src"]`, never
  `["src/**/*.ts"]` — or the files cannot be admitted into the TypeScript
  program (the scaffold's tsconfig already does this).
- **A TypeScript to load.** The language server is bundled, but the TypeScript
  it runs is resolved from your **workspace** (`node_modules/typescript`) first,
  falling back to VS Code's built-in copy. If neither is found the extension
  shows an error and does not start the server — install `typescript` in the
  project (the scaffold does).

## Debugging

Add the **Nola: Launch File** snippet from *Add Configuration…* in
`launch.json`, or use the one the scaffold wrote. It runs
`node --import nola-lang/register --enable-source-maps` with
`resolveSourceMapLocations` and `skipFiles` set so breakpoints and stepping stay
in `.tsi` source. Why each key matters:
[Editor setup → Debugging with F5](https://nola.sh/docs/start/editor-setup/#debugging-with-f5).

## Snippets

One snippet per construct, in `.tsi` files. Type `infer` or `ask` and the whole
family appears in completion alongside the language server's suggestions.

| Prefix | Expands to |
|---|---|
| `infer` | `infer function name(params) { … }` |
| `inferc` | infer function with a contextual `.param` |
| `inferi` | infer function carrying an `` `instruction` `` for the model |
| `ask` | `` ask ..`instruction`<Type> `` — a typed extractor |
| `askfree` | `` ask ..`instruction` `` — free text, kept in the invocation's history |
| `askwith` | `` ask with provider ..`instruction`<Type> `` — routed through a named provider |
| `calli` | `` callee``(..`instruction`<Type>) `` — a call intent (the model fills the argument) |
| `extract` | `` ..`instruction`<Type> `` — a bare extractor to resolve later |

## Other editors

This extension targets VS Code (and VS Code-based editors). For anything else,
wire `@nola-lang/language-server` and `@nola-lang/typescript-plugin` into your
LSP client — see
[Editor setup → Other editors](https://nola.sh/docs/start/editor-setup/#other-editors).

## Links

- Documentation: [nola.sh/docs](https://nola.sh/docs/) · [VS Code extension page](https://nola.sh/docs/tooling/vscode/)
- Source: [github.com/nola-lang/nola](https://github.com/nola-lang/nola) (`packages/vscode`)
- Issues: [github.com/nola-lang/nola/issues](https://github.com/nola-lang/nola/issues)

## License

[Apache-2.0](https://github.com/nola-lang/nola/blob/main/LICENSE)
