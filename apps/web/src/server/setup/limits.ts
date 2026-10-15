/**
 * Limits that keep anonymous setup from spending the model budget: rate limits per IP and per
 * draft owner, a cap on chat messages per draft, and a spend cap for setup's model calls that
 * leaves the rest of the budget to grading.
 */
import { Db, schema } from "@goblins/domain";
import { and, eq, gt, inArray, lt, sql } from "drizzle-orm";
import { Data, Effect } from "effect";

export type ThrottledAction = "upload" | "chat";

/** Per caller key (an IP, a draft owner), per hour. */
export const HOURLY_LIMITS: Record<ThrottledAction, number> = { upload: 5, chat: 30 };

/** Teacher messages per draft. A chat call sends the whole draft, so it must stay bounded. */
export const CHAT_MESSAGES_PER_DRAFT = 30;

/** Model turns sent with each chat call: the latest ones are enough to follow the conversation. */
export const CHAT_HISTORY_TURNS = 10;

export class RateLimited extends Data.TaggedError("RateLimited")<{
  readonly action: ThrottledAction;
}> {}

/**
 * Records one `action` for each key, or fails with `RateLimited` if any key has reached its
 * hourly limit. Two racing requests can both pass at the edge; the limit is a budget guard, not
 * an exact quota.
 */
export const takeToken = (action: ThrottledAction, keys: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const db = yield* Db;
    const hourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const counts = yield* db
      .select({ key: schema.rateLimitEvents.key, n: sql<number>`count(*)::int` })
      .from(schema.rateLimitEvents)
      .where(
        and(
          eq(schema.rateLimitEvents.action, action),
          inArray(schema.rateLimitEvents.key, [...keys]),
          gt(schema.rateLimitEvents.createdAt, hourAgo),
        ),
      )
      .groupBy(schema.rateLimitEvents.key);
    if (counts.some((row) => row.n >= HOURLY_LIMITS[action])) {
      return yield* Effect.fail(new RateLimited({ action }));
    }
    yield* db.insert(schema.rateLimitEvents).values(keys.map((key) => ({ action, key })));
    // Housekeeping: nothing older than a day is ever read.
    yield* db
      .delete(schema.rateLimitEvents)
      .where(
        and(
          eq(schema.rateLimitEvents.action, action),
          lt(schema.rateLimitEvents.createdAt, new Date(Date.now() - 24 * 60 * 60 * 1000)),
        ),
      );
  });

/** The caller keys for a request: its IP, when known, and who owns the draft. */
export const callerKeys = (ip: string | undefined, owner: string): ReadonlyArray<string> =>
  ip === undefined ? [`owner:${owner}`] : [`ip:${ip}`, `owner:${owner}`];

export class SetupBudgetSpent extends Data.TaggedError("SetupBudgetSpent") {}

const setupCapUsd = () => {
  const value = Number(process.env.SETUP_SPEND_CAP_USD ?? "3");
  return Number.isFinite(value) && value >= 0 ? value : 3;
};

/**
 * Fails once setup's real model calls (extraction and setup chat, from `model_calls`) have cost
 * `SETUP_SPEND_CAP_USD` (default $3), so setup can't eat grading's share of the budget.
 */
export const ensureSetupBudget = Effect.gen(function* () {
  const db = yield* Db;
  const [row] = yield* db
    .select({ spent: sql<number>`coalesce(sum(${schema.modelCalls.costUsd}), 0)::float8` })
    .from(schema.modelCalls)
    .where(
      and(
        inArray(schema.modelCalls.purpose, ["extract", "rubric-chat"]),
        eq(schema.modelCalls.provider, "openrouter"),
      ),
    );
  if ((row?.spent ?? 0) >= setupCapUsd()) return yield* Effect.fail(new SetupBudgetSpent());
  // A database failure here is an outage, not an expected outcome callers handle.
}).pipe(Effect.catchTag("SqlError", (e) => Effect.die(e)));
