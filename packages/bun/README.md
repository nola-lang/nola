# @nola-lang/bun

Bun plugin for [Nola](https://github.com/nola-lang/nola) `.tsi` modules: run
`.tsi` from source under Bun, bundle or compile in one step with `Bun.build`,
load `.tsi` modules in `bun test`.

```sh
bun add -d @nola-lang/bun
```

```toml
# bunfig.toml
preload = ["@nola-lang/bun/preload"]

[test]
preload = ["@nola-lang/bun/preload"]
```

```sh
bun src/main.tsi          # .tsi from source, nola.config.ts applied
bun --watch src/main.tsi
bun test                  # test files import .tsi modules
```

One step from `.tsi` to a bundle or a single executable:

```ts
// build.ts
import { nola } from "@nola-lang/bun";

await Bun.build({
  entrypoints: ["src/main.tsi"],
  plugins: [nola()],
  target: "bun",
  compile: { outfile: "my-app" }, // or outdir: "dist"
});
```

Without the plugin, `nola build` output runs under Bun as it is:
`bun dist/src/main.tsi.js`, `bun build --compile dist/src/main.tsi.js`.

- Bun ≥ 1.3. The `nola` CLI (`nola check`, `nola build`, `nola console`)
  runs on Node; `bun run check` launches it there.
- Nola execution is **server-only in v0**: a `Bun.build` for
  `target: "browser"` fails with `NOLA4001`.
- A Bun plugin carries no source map, so stack traces through `.tsi` code
  show lowered positions: lines are right at module level and in plain
  functions, one too high inside an `infer function` body, and columns
  inside an `ask` may drift. `bun --watch` restarts the process and is the
  supported watch mode.
- Options (`nola(options)`): `target` (`"app" | "lib"`), `config` (a path,
  or `false` to skip the config wiring in a bundle).

Docs: https://nola.sh/docs/tooling/bun/
