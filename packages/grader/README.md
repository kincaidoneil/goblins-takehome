# @goblins/grader

The grading pipeline. A student's submission becomes a queue message, a Vercel Function grades it with one model call, and the grade lands in Postgres in one of the PRD's states. Every model call is logged with its latency, status, tokens and cost.

```
submit (apps/web)                       Vercel Queues, topic "grade"           consumer (this package)
───────────────────                     ────────────────────────────           ───────────────────────
submitWork: grade row in `submitted` ┐  at-least-once, 7-day retention,        startGrading: claim a 120 s lease
commit                               └▶ dedupe on grade:<id>:<attempt>,  ──▶   ├─ Stale ─▶ ack
send { submissionId, attempt }          maxConcurrency in-flight cap           ├─ InProgress ─▶ redeliver later
                                                                               └─ Claimed ─▶ grade(input), ≤ 3 tries, ≤ 100 s
cron, every minute: stuckJobs ─▶ resend                                            ├─ ok ─▶ recordOutcome: graded / needs_teacher
(queued > 3 min, or lease expired)                                                 ├─ transient error ─▶ releaseClaim, redeliver after backoff
                                                                                   └─ retries exhausted ─▶ recordOutcome: couldnt_grade
```

## Modules

| Module | What it does |
| --- | --- |
| `ModelClient` | The one interface for model calls. Mock (`packages/mock-model`) and OpenRouter implementations. |
| `OpenRouter` | The real client. Dies at build time unless `MODEL_CLIENT=openrouter`. |
| `CallLog` | Wraps any client so every call is timed and recorded. |
| `Grader` | The seam the AI-quality stream fills: `grade(input, tag) → Sure \| Unsure`, or a `ModelError`. `input` is the domain's `GradingInput`. `placeholder` is a single-call stand-in. |
| `GradeStore` | The domain package's pipeline operations (`startGrading`, `recordOutcome`, `releaseClaim`, `stuckJobs`) as one service. `postgres` calls them; `inMemory` follows the same rules for fast tests. |
| `Consumer` | `handleGradeJob(job, delivery) → Done \| RetryLater`, the model router for load tests, and the stuck-grade sweeper. |
| `RetryPolicy` | The pure rule for retrying or giving up. |
| `VercelQueue` | Sends jobs and adapts push deliveries to `handleGradeJob`. |
| `InProcessQueue` | Local and test stand-in with the same cap, redelivery and dedupe. |

## How it holds up

**No lost submissions.** The submit path commits the grade row before it sends the job. If the send fails or the function dies in between, the grade sits in `submitted`. The sweeper resends anything queued for more than 3 minutes, or claimed by a delivery whose lease ran out. Its resends use a key that changes every 10 minutes: with the submit path's key, a resend for a message the queue had dropped would itself be dropped for the 24-hour dedupe window. Messages are kept for 7 days, so a broken consumer deploy delays grades until it is fixed rather than dropping them overnight.

**Idempotent writes.** Delivery is at-least-once. The domain package owns the grade row's state machine:

- `startGrading` claims the attempt with a 120 s lease, so a second delivery of the same attempt is told `InProgress` and makes no model call.
- `recordOutcome` writes only if the lease is still held.
- A teacher's retry bumps the attempt, which makes every older message `Stale`.

One delivery's grading is capped at 100 s, so a live delivery never outlives its lease. A delivery whose function crashed is taken over once the lease runs out. Tests cover duplicate, racing, crashed and stale deliveries, and a teacher acting mid-grade.

**Retries.** Rate limits, timeouts, 5xx and dropped connections are retried by the queue, not in a loop inside the function, so a waiting grade holds no concurrency slot. Before asking for redelivery, the consumer releases its claim so the next delivery can take it at once. Backoff is 2 s, 4 s, 8 s … capped at 60 s, with ±20% jitter so a burst of failures does not retry in lockstep, and never shorter than the provider's `Retry-After`. Unusable answers (malformed JSON, cut off) are retried immediately inside the same delivery, three tries in all. Errors that retrying cannot fix, such as a 400 or 402 (out of credits), fail at once.

**A 5-minute outage delays grades and fails none.** Transient errors keep retrying until a grade has waited 15 minutes, three times the outage the PRD asks us to absorb. Because backoff is capped at 60 s, grades resume within about a minute of the provider coming back. After 15 minutes the grade becomes `couldnt_grade`, and the teacher can retry it or score it.

**Concurrency cap.** The queue limits model calls in flight. That protects the provider's rate limits, our database connections and the budget. OpenRouter sets no request cap on paid models, so the binding limits are the upstream provider's and our own. A cap of 100 is a reasonable start: by Little's law, at about 4 s per call, 100 in flight sustains 25 grades/s. A testing day of 1,000 students (10 submissions each over 30 minutes) averages about 6 grades/s, and the bell spike runs perhaps three times that. The load test finds the real limit.

Which queue enforces the cap is still open. Vercel Queues enforces it through an undocumented `maxConcurrency` on the trigger. Infra measured it: 60 five-second jobs at cap 10 took 129 s, against an ideal 30 s. Upstash QStash flow control (parallelism and rate) is the preferred alternative. It is being benchmarked the same way, and the result goes in `docs/decisions.md`. The consumer does not depend on the choice: `handleGradeJob` takes a job and a delivery count and returns `Done` or `RetryLater`, and each queue gets a thin adapter (`VercelQueue` today).

**Load tests never spend money.** A grade whose class session carries a `loadTestRunId` (read into `GradingInput` at claim time) is graded by `LoadTestModelClient` (the mock), whatever `MODEL_CLIENT` the deploy uses. Its call-log rows carry the run id, so they can be excluded from reports and deleted after the run.

## Wiring it into the app

The consumer route, `vercel.json` and the cron belong to `apps/web` and Infra. What they need:

```ts
// apps/web: the queue consumer route
const runtime = ManagedRuntime.make(
  Consumer.ModelRouterLive.pipe(
    Layer.provideMerge(Layer.mergeAll(GradeStore.postgres, Layer.succeed(Grader.Grader, Grader.placeholder))),
    Layer.provide(Layer.mergeAll(ModelClientLive, LoadTestModelClientLive, CallLogLive)),
    Layer.provide(DatabaseLive), // from @goblins/domain
  ),
)
export const POST = VercelQueue.makeHandler(runtime)
```

```json
{
  "functions": {
    "<path to the consumer route>": {
      "maxDuration": 300,
      "experimentalTriggers": [
        { "type": "queue/v2beta", "topic": "grade", "maxConcurrency": 100, "retryAfterSeconds": 10, "maxDeliveries": 40 }
      ]
    }
  },
  "crons": [{ "path": "/api/cron/sweep-grades", "schedule": "* * * * *" }]
}
```

`maxDeliveries` is a backstop for crashes (defects the consumer does not model, which the adapter redelivers every 10 s). The 15-minute retry budget needs about 20 deliveries, so 40 never cuts a modeled retry short. If a message is dropped anyway, the sweeper resends it.

The sweeper route calls `sweepStuckGrades({ queuedFor: Duration.minutes(3), limit: 500 })` with `GradeStore.postgres` and `VercelQueue.makeQueue()`.

`maxConcurrency` on a `queue/v2beta` trigger is accepted by Vercel's build schema (`@vercel/build-utils`, 1 to 8192) but is not yet in the `vercel.json` docs. Confirming that it holds on the real deploy is an open task.

## Tests

```sh
pnpm --filter @goblins/grader test
```

`Consumer.test.ts` runs the in-process queue, the consumer, the placeholder grader, the call log and the in-memory store against a scripted model, on virtual time. It covers:

- the concurrency cap
- retries with backoff
- a 5-minute outage that delays grades and fails none
- giving up after 15 minutes
- unusable answers, including a rubric line scored twice
- the per-delivery time cap
- duplicate, racing, crashed and stale deliveries
- a teacher acting mid-grade
- load-test routing
- the sweeper
- a database outage during the grade write

`Consumer.pg.test.ts` runs the same consumer on real Postgres: PGlite, migrated with the domain package's migrations, through the domain's own functions. It covers a class graded under the cap, racing deliveries, the outage, a teacher's retry, load-test routing and the sweeper.
