/**
 * Database layers. Use `Db` for queries and `SqlClient` (from @effect/sql) for transactions:
 *
 *   const db = yield* Db
 *   const rows = yield* db.select().from(students).where(eq(students.sessionId, id))
 *   yield* sql.withTransaction(effect)
 *
 * Always build the Drizzle client with `DbLive`, never `PgDrizzle.layer`: the schema uses
 * snake_case column names, and Drizzle only maps them when `casing` is set.
 */
import * as PgDrizzle from "@effect/sql-drizzle/Pg"
import { PgClient } from "@effect/sql-pg"
import { Config, Layer, Redacted } from "effect"

export { PgDrizzle as Db } from "@effect/sql-drizzle/Pg"
export { SqlClient } from "@effect/sql/SqlClient"
export type { SqlError } from "@effect/sql/SqlError"

/** Drizzle on top of whatever `SqlClient` is provided. */
export const DbLive = PgDrizzle.layerWithConfig({ casing: "snake_case" })

/** A Postgres client for a connection string. */
export const pgClientLayer = (options: { readonly url: string; readonly maxConnections?: number }) =>
  PgClient.layer({
    url: Redacted.make(options.url),
    maxConnections: options.maxConnections ?? 10
  })

/** Postgres from `DATABASE_URL`, with Drizzle on top. Provides both `Db` and `SqlClient`. */
export const DatabaseLive = DbLive.pipe(
  Layer.provideMerge(
    PgClient.layerConfig({
      url: Config.redacted("DATABASE_URL")
    })
  )
)

/** Like `DatabaseLive`, for an explicit connection string. */
export const databaseLayer = (options: { readonly url: string; readonly maxConnections?: number }) =>
  DbLive.pipe(Layer.provideMerge(pgClientLayer(options)))
