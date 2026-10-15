/**
 * Applies the checked-in migrations to `DATABASE_URL`. Run on deploy: `pnpm --filter @goblins/domain db:migrate`.
 */
import { drizzle } from "drizzle-orm/node-postgres"
import { migrate } from "drizzle-orm/node-postgres/migrator"
import { fileURLToPath } from "node:url"
import pg from "pg"

const migrationsFolder = fileURLToPath(new URL("../migrations", import.meta.url))

const url = process.env.DATABASE_URL
if (url === undefined || url === "") {
  console.error("DATABASE_URL is not set")
  process.exit(1)
}
const pool = new pg.Pool({ connectionString: url, max: 1 })
await migrate(drizzle(pool), { migrationsFolder })
await pool.end()
console.log("Migrations applied")
