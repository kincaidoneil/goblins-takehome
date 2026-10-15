/**
 * A real Postgres for tests: PGlite (Postgres compiled to WASM) in-process, migrated with the
 * checked-in migrations and served over the wire protocol, so the code under test runs through
 * the same @effect/sql-pg client as production.
 */

import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { Effect, Layer } from "effect";
import { databaseLayer } from "../src/db";

const migrationsFolder = fileURLToPath(new URL("../migrations", import.meta.url));

export const TestDatabase = Layer.unwrapScoped(
  Effect.gen(function* () {
    const pglite = yield* Effect.acquireRelease(
      Effect.promise(() => PGlite.create()),
      (db) => Effect.promise(() => db.close()),
    );
    yield* Effect.promise(() => migrate(drizzle(pglite), { migrationsFolder }));
    const server = new PGLiteSocketServer({ db: pglite, port: 0, host: "127.0.0.1" });
    yield* Effect.acquireRelease(
      Effect.promise(() => server.start()),
      () => Effect.promise(() => server.stop()),
    );
    const url = `postgres://postgres:postgres@${server.getServerConn()}/postgres?sslmode=disable`;
    return databaseLayer({ url, maxConnections: 1 });
  }),
);
