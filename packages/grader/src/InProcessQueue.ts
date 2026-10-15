/**
 * An in-process stand-in for Vercel Queues, for tests and local runs before a
 * deploy exists. It keeps the properties the pipeline relies on: a concurrency
 * cap, delayed redelivery with a delivery count, and idempotency-key dedupe.
 * It is not durable; the Vercel adapter is.
 */
import { Clock, Effect, Ref, Stream, SubscriptionRef } from "effect";
import {
  type Delivery,
  type Disposition,
  type GradeJob,
  type GradeQueue,
  idempotencyKey,
} from "./Consumer.ts";

export interface Stats {
  readonly deliveries: number;
  readonly maxInFlight: number;
}

export const make = <R>(options: {
  readonly concurrency: number;
  readonly handle: (job: GradeJob, delivery: Delivery) => Effect.Effect<Disposition, never, R>;
}) =>
  Effect.gen(function* () {
    const runtime = yield* Effect.runtime<R>();
    const permits = yield* Effect.makeSemaphore(options.concurrency);
    const seen = yield* Ref.make(new Set<string>());
    const outstanding = yield* SubscriptionRef.make(0);
    const inFlight = yield* Ref.make(0);
    const stats = yield* Ref.make<Stats>({ deliveries: 0, maxInFlight: 0 });

    const run = (job: GradeJob, delivery: Delivery) =>
      Effect.acquireUseRelease(
        Ref.updateAndGet(inFlight, (n) => n + 1).pipe(
          Effect.tap((n) =>
            Ref.update(stats, (s) => ({
              deliveries: s.deliveries + 1,
              maxInFlight: Math.max(s.maxInFlight, n),
            })),
          ),
        ),
        () => options.handle(job, delivery),
        () => Ref.update(inFlight, (n) => n - 1),
      );

    const deliver = (job: GradeJob, delivery: Delivery): Effect.Effect<void, never, R> =>
      permits
        .withPermits(1)(run(job, delivery))
        .pipe(
          Effect.flatMap((disposition) =>
            disposition._tag === "Done"
              ? SubscriptionRef.update(outstanding, (n) => n - 1)
              : Effect.sleep(disposition.after).pipe(
                  Effect.zipRight(
                    Effect.suspend(() =>
                      deliver(job, { ...delivery, deliveryCount: delivery.deliveryCount + 1 }),
                    ),
                  ),
                ),
          ),
        );

    const enqueue: GradeQueue["Type"]["enqueue"] = (job, key = idempotencyKey(job)) =>
      Effect.gen(function* () {
        const fresh = yield* Ref.modify(seen, (keys) =>
          keys.has(key) ? [false, keys] : [true, new Set(keys).add(key)],
        );
        if (!fresh) return;
        yield* SubscriptionRef.update(outstanding, (n) => n + 1);
        const now = yield* Clock.currentTimeMillis;
        yield* Effect.forkDaemon(
          Effect.provide(deliver(job, { deliveryCount: 1, enqueuedAt: new Date(now) }), runtime),
        );
      });

    /** Waits until every enqueued job has been acknowledged. */
    const drained = outstanding.changes.pipe(
      Stream.takeUntil((n) => n === 0),
      Stream.runDrain,
    );

    return { queue: { enqueue } satisfies GradeQueue["Type"], drained, stats: Ref.get(stats) };
  });
