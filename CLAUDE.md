# futtarns (freitach)

Friday food ordering for a friend group: Next.js 16 app at the root, WhatsApp bot in `bot/`.
UI text is German; code, comments and docs are English. Start with
[docs/architecture.md](docs/architecture.md).

- Logic lives in `lib/` (pure functions with tests) and `lib/services/` (database, tested
  against in-memory PGlite). Pages and components only render and call `app/actions.ts`.
- Every server action re-checks permissions with `lib/permissions.ts`; never trust ids or
  amounts from the browser.
- Times are Europe/Berlin (`lib/dates.ts`); a Friday is an ISO day string.
- Schema changes: edit `lib/db/schema.ts`, then `pnpm db:generate --name <change>`.
- Before pushing: `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test`.

@AGENTS.md
