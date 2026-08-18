# @nola-lang/language-server

The [Nola](https://github.com/nola-lang/nola) language server — diagnostics,
hover, completion, and go-to-definition for `.tsi` files over LSP. VS Code
users get this through the Nola extension; other editors (Neovim, Helix, Zed,
…) run it directly:

```bash
npm i -g @nola-lang/language-server
```

Entry point: `@nola-lang/language-server/server.cjs` (stdio). Point your
editor's LSP client at it for the `nola` language / `.tsi` extension.
