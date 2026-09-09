# @nola-lang/console

The local [Nola](https://github.com/nola-lang/nola) Console: trace ingestion,
storage and API for observing every `ask`. Started from the CLI:

```bash
npx nola-lang console
```

The console binds `http://localhost:4141` (loopback only; the first free port
upward, `--port` overrides), stores traces in one per-machine database at
`~/.nola/console/data/console.db` (built-in Node SQLite — Node ≥ 22.13),
and receives events from any Nola app that has
`NOLA_TRACING_URL` set or a connection in its `nola.config.ts` —
`hooks: [tracer("<url>")]`, or `export default nola({ baseUrl: "<url>", model: … })` when the console serves the whole stack.

Endpoints: `POST /v1/ingest` and `GET /v1/capabilities` (the Nola wire
protocol), `GET /api/projects`, `GET /api/records`, `GET /api/traces/:id`,
`GET /api/asks/:id`, `GET /api/definitions`, `GET /api/definitions/:def`,
`DELETE /api/records` (clear everything), `GET /api/events` (SSE).

You normally install `nola-lang` (which depends on this package) rather than
installing `@nola-lang/console` directly. Docs: <https://nola.sh/docs/>.
