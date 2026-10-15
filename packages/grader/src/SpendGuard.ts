/**
 * A hard cap on real model spend, enforced before every OpenRouter call.
 *
 * The key Goblins issued holds more than the PRD's $20 budget, and we can't lower
 * its limit, so the cap lives here: `MODEL_SPEND_CAP_USD`, default 20. Spend is
 * OpenRouter's own count for the key (`GET /api/v1/key`, refreshed every 30 s)
 * plus what this instance has spent since that refresh. Each serverless
 * instance keeps its own running total, so across instances the cap can be
 * overshot by at most about 30 s of spend: cents at the PRD's cost per grade.
 */
import { Clock, Effect, Option, Redacted, Ref, Schema } from "effect";
import { BudgetExceeded, ProviderError } from "./ModelClient.ts";

export interface SpendGuard {
  /** Fails with `BudgetExceeded` when spend has reached the cap. */
  readonly check: Effect.Effect<void, BudgetExceeded | ProviderError>;
  /** Adds the cost of a call this instance just made. */
  readonly add: (costUsd: number) => Effect.Effect<void>;
}

/** How long a fetched usage figure is trusted before it is fetched again. */
export const REFRESH_MS = 30_000;

interface Snapshot {
  readonly fetchedAtMs: number;
  readonly keyUsageUsd: number;
  /** Spent by this instance since `fetchedAtMs`. */
  readonly sinceUsd: number;
}

export const make = (options: {
  readonly capUsd: number;
  /** The key's total usage in USD, as the provider counts it. */
  readonly fetchUsage: Effect.Effect<number, unknown>;
}) =>
  Effect.gen(function* () {
    const snapshot = yield* Ref.make(Option.none<Snapshot>());
    const lock = yield* Effect.makeSemaphore(1);

    /** The current snapshot, refetched when stale. Only one refetch runs at a time. */
    const current = lock.withPermits(1)(
      Effect.gen(function* () {
        const nowMs = yield* Clock.currentTimeMillis;
        const last = yield* Ref.get(snapshot);
        if (Option.isSome(last) && nowMs - last.value.fetchedAtMs < REFRESH_MS) return last.value;
        const fetched = yield* Effect.either(options.fetchUsage);
        if (fetched._tag === "Right") {
          const fresh = { fetchedAtMs: nowMs, keyUsageUsd: fetched.right, sinceUsd: 0 };
          yield* Ref.set(snapshot, Option.some(fresh));
          return fresh;
        }
        // Keep using the last known figure; with none, we can't tell whether spending is safe.
        if (Option.isSome(last)) return last.value;
        return yield* new ProviderError({
          status: 0,
          message: `could not read the key's spend to check the cap: ${String(fetched.left)}`,
        });
      }),
    );

    const guard: SpendGuard = {
      check: Effect.gen(function* () {
        const s = yield* current;
        const spentUsd = s.keyUsageUsd + s.sinceUsd;
        if (spentUsd >= options.capUsd) {
          return yield* new BudgetExceeded({ spentUsd, capUsd: options.capUsd });
        }
      }),
      add: (costUsd) =>
        Ref.update(
          snapshot,
          Option.map((s) => ({ ...s, sinceUsd: s.sinceUsd + costUsd })),
        ),
    };
    return guard;
  });

const KeyResponse = Schema.Struct({ data: Schema.Struct({ usage: Schema.Number }) });

/** Reads the key's total usage from OpenRouter. Free: it is not a model call. */
export const fetchOpenRouterUsage = (options: {
  readonly apiKey: Redacted.Redacted;
  readonly baseUrl: string;
}) =>
  Effect.gen(function* () {
    const response = yield* Effect.tryPromise(() =>
      fetch(`${options.baseUrl}/key`, {
        headers: { Authorization: `Bearer ${Redacted.value(options.apiKey)}` },
      }).then(async (res) => ({ status: res.status, body: await res.text() })),
    );
    if (response.status !== 200) return yield* Effect.fail(`GET /key answered ${response.status}`);
    const body = yield* Schema.decodeUnknown(Schema.parseJson(KeyResponse))(response.body);
    return body.data.usage;
  });
