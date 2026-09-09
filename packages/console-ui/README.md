# @nola-lang/console-ui

The web UI `nola console` serves. Private: `npm run bundle` type-checks and
builds it into `../console/dist/ui`, which `@nola-lang/console` ships and
serves. Stack: React, react-router, TanStack Query/Table, shadcn/ui
(Tailwind v4 + radix-ui), Recharts, lucide-react.

`npm run dev -w @nola-lang/console-ui` runs Vite beside a running
`nola console` (API proxied to :4141).
