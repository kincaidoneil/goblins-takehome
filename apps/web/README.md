# @goblins/web

The TanStack Start app: teacher setup, projector, student work, dashboard and report.

## Run it locally

```bash
pnpm --filter @goblins/web db:up        # Postgres (port 55432) and Electric (port 30001) in Docker
DATABASE_URL=postgres://postgres:postgres@localhost:55432/goblins pnpm --filter @goblins/domain db:migrate
docker compose -f apps/web/docker-compose.yml exec -T postgres psql -U postgres -d goblins < apps/web/seed-dev.sql
pnpm --filter @goblins/web dev          # http://localhost:3000, join code 123456
```

`local.env` holds the non-secret local defaults. Clerk keys come from `.env.local` at the repo root.

## How it fits together

- **Writes** go through server functions (`src/server/fns`). Each runs an Effect against the domain package and returns expected failures as values (`src/server/result.ts`).
- **Live reads** are TanStack DB collections synced from Electric (`src/lib/sync.ts`) through `/api/shape`. The proxy (`src/server/shapes.ts`) maps a named view to a table, filter and columns after checking who is asking. The browser never sends a `where` clause.
- **Teachers** sign in with Clerk. The first request after sign-in creates their `teachers` row.
- **Students** have no accounts. Joining sets a signed, HTTP-only cookie per session naming the student (`src/server/student-identity.ts`).
