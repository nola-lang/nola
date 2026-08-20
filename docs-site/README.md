# Nola documentation

These are the source files for the documentation published at
**https://nola.sh/docs**. They are authored here, in the language repo, so that
a syntax change and the docs describing it land in the same commit.

Read the docs at [nola.sh/docs](https://nola.sh/docs) — these files are Starlight
`.mdx` and GitHub shows them as raw source.

Edit them **here**. nola-website consumes this directory through its
`scripts/sync-docs.mjs`, which copies it verbatim; its copy under
`packages/nola-web/src/content/docs/docs/` is generated, and any hand-edit there
is reverted by the next sync.

## Authoring contract

The sync performs **no transform** — these files are exactly what Starlight
builds. That is the property to protect, so the contract is thin but firm:

- **Frontmatter is exactly `title`, `description` and `sidebar.order`.**
  `description` must be **50–160 characters**: it drives the meta description,
  the OG card body and llms.txt, and the site build fails outside that range.
- **Internal links are site-absolute with a trailing slash** —
  `/docs/language/ask/#ask-vs-await`. Every link must resolve to a real page.
- **Component imports may only come from `@astrojs/starlight/components`.**
  Importing site-local code would break the copy-only sync.
- **Pages live in one of ten group directories** — `start/`, `language/`,
  `config/`, `guides/`, `tooling/`, `reference/`, `internals/`, `compare/`,
  `examples/`, `project/` — plus the root `index.mdx`. The directory is the URL
  segment (`/docs/<dir>/<page>/`) and the website's sidebar is built from exactly
  these names (labels and order live there); a page anywhere else would sync but
  never appear in the sidebar. `test/docs-site.test.ts` enforces the set.
- **Fences:** ` ```tsi ` for Nola; ` ```ts `, ` ```js `, ` ```sh `, ` ```json `,
  ` ```jsonc ` (tsconfig, launch.json) and ` ```txt ` otherwise.
  Every `tsi` fence is compiled by `scripts/check-docs.mjs`; mark a deliberately
  invalid sample with `// not-checked` as the fence's first line.
- **Error-code headings are the bare code** (`## NOLA1001`). The slug `#nola1001`
  is a URL contract — never append words.
- **Assets** live in `docs-site/assets/` and are referenced relatively.
- **Line endings are pinned to LF** by the repo's `.gitattributes`. The sync
  compares raw bytes, which is stricter than git — without the pin, a
  freshly checked-out file (CRLF under `core.autocrlf`) and a copied one (LF)
  differ on disk while git considers them identical, and `--check` reports
  drift on content nobody changed. Do not exempt this directory.
- **Never link into `docs/`** — the specs, plans and internal notes there are
  withheld from the public mirror, so such a link is dead on GitHub.

## Checks

- `npx vitest run test/docs-site.test.ts` — the contract above, including dead links.
- `npx vitest run test/docs-error-codes.test.ts` — every diagnostic code is documented.
- `node scripts/check-docs.mjs` — compiles every `tsi` fence (needs `npm run build` first).
