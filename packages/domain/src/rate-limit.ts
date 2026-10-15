/**
 * Abuse limits as fixed-window counters in Postgres, so every function instance shares them.
 * Joins, submissions and grade jobs each count against a few keys (an IP, a student, a teacher).
 */
import { and, eq, gte, lt, sql } from "drizzle-orm";
import { Effect } from "effect";
import { Db } from "./db";
import { rateLimits } from "./schema";

export interface Limit {
  /** What is being counted, e.g. `join:ip:203.0.113.7`. */
  readonly key: string;
  readonly max: number;
  readonly windowSeconds: number;
}

const windowStart = (limit: Limit, now: Date) => {
  const ms = limit.windowSeconds * 1000;
  return new Date(Math.floor(now.getTime() / ms) * ms);
};

/**
 * Counts one request against the limit unless the window is used up. True when the request is
 * allowed. A denied request isn't counted, so retries can't push the window further.
 */
export const consume = (limit: Limit, now: Date = new Date()) =>
  Effect.gen(function* () {
    const db = yield* Db;
    const start = windowStart(limit, now);
    const counted = yield* db
      .insert(rateLimits)
      .values({ key: limit.key, windowStart: start, count: 1 })
      .onConflictDoUpdate({
        target: [rateLimits.key, rateLimits.windowStart],
        set: { count: sql`${rateLimits.count} + 1` },
        setWhere: lt(rateLimits.count, limit.max),
      })
      .returning({ count: rateLimits.count });
    // About one call in a hundred clears out old windows.
    if (Math.random() < 0.01) {
      yield* db
        .delete(rateLimits)
        .where(lt(rateLimits.windowStart, new Date(now.getTime() - 86_400_000)));
    }
    return counted.length > 0;
  });

/** Whether the limit's current window is used up, without counting anything. */
export const usedUp = (limit: Limit, now: Date = new Date()) =>
  Effect.gen(function* () {
    const db = yield* Db;
    const [row] = yield* db
      .select({ count: rateLimits.count })
      .from(rateLimits)
      .where(
        and(
          eq(rateLimits.key, limit.key),
          eq(rateLimits.windowStart, windowStart(limit, now)),
          gte(rateLimits.count, limit.max),
        ),
      );
    return row !== undefined;
  });
