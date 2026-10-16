# @goblins/grader

The grading pipeline. A student's submission becomes a queue message, a Vercel Function grades it with one model call, and the grade lands in Postgres in one of the PRD's states. Every model call is logged with its latency, status, tokens and cost.

```
submit (apps/web)                       Upstash QStash                          consumer (this package)
───────────────────                     ──────────────                          ───────────────────────
submitWork: grade row in `submitted` ┐  at-least-once, signed deliveries,       startGrading: claim a 120 s lease
commit                               └▶ dedupe on grade:<id>:<attempt>,  ──▶    ├─ Stale ─▶ ack
publish { job, deliveryCount: 1 }       flow control: key "grade",              ├─ InProgress ─▶ delayed republish, ack
                                        parallelism ≤ 100                       └─ Claimed ─▶ grade(input), ≤ 3 tries, ≤ 100 s
QStash schedule, every minute:                                                      ├─ ok ─▶ recordOutcome: graded / needs_teacher
stuckJobs ─▶ resend                                                                 ├─ transient error ─▶ releaseClaim, delayed republish, ack
(queued > 3 min, or lease expired)                                                  └─ retries exhausted ─▶ recordOutcome: couldnt_grade
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
| `QStashQueue` | Publishes jobs with QStash flow control, verifies and handles deliveries, schedules retries as delayed messages, and keeps the sweeper's schedule. |
| `InProcessQueue` | Local and test stand-in with the same cap, redelivery and dedupe. |

## How it holds up

**No lost submissions.** The submit path commits the grade row before it sends the job. If the send fails or the function dies in between, the grade sits in `submitted`. The sweeper resends anything queued for more than 3 minutes, or claimed by a delivery whose lease ran out. Its resends use a key that changes every 10 minutes, so the queue's dedupe can never swallow a resend for a message it already dropped. A consumer that crashes is redelivered by QStash three times, then the message goes to QStash's dead-letter queue; the grade is still `submitted` or `grading` in Postgres, so the sweeper sends it again. The database, not the queue, is the record of what still needs grading.

**Idempotent writes.** Delivery is at-least-once. The domain package owns the grade row's state machine:

- `startGrading` claims the attempt with a 120 s lease, so a second delivery of the same attempt is told `InProgress` and makes no model call.
- `recordOutcome` writes only if the lease is still held.
- A teacher's retry bumps the attempt, which makes every older message `Stale`.

One delivery's grading is capped at 100 s, so a live delivery never outlives its lease. A delivery whose function crashed is taken over once the lease runs out. Tests cover duplicate, racing, crashed and stale deliveries, and a teacher acting mid-grade.

**Retries.** Rate limits, timeouts, 5xx and dropped connections are retried by the queue, not in a loop inside the function, so a waiting grade holds no concurrency slot. Before asking for redelivery, the consumer releases its claim so the next delivery can take it at once. Backoff is 2 s, 4 s, 8 s … capped at 60 s, with ±20% jitter so a burst of failures does not retry in lockstep, and never shorter than the provider's `Retry-After`. Unusable answers (malformed JSON, cut off) are retried immediately inside the same delivery, three tries in all. Errors that retrying cannot fix, such as a 400 or 402 (out of credits), fail at once.

**A 5-minute outage delays grades and fails none.** Transient errors keep retrying until a grade has waited 15 minutes, three times the outage the PRD asks us to absorb. Because backoff is capped at 60 s, grades resume within about a minute of the provider coming back. After 15 minutes the grade becomes `couldnt_grade`, and the teacher can retry it or score it.

**Concurrency cap.** The queue limits model calls in flight. That protects the provider's rate limits, our database connections and the budget. OpenRouter sets no request cap on paid models, so the binding limits are the upstream provider's and our own. A cap of 100 is a reasonable start: by Little's law, at about 4 s per call, 100 in flight sustains 25 grades/s. A testing day of 1,000 students (10 submissions each over 30 minutes) averages about 6 grades/s, and the bell spike runs perhaps three times that. The load test finds the real limit.

The queue is Upstash QStash with flow control: every grade message carries the key `grade` and `parallelism=N`, so at most N deliveries are in flight across all instances. Measured with 5-second jobs, QStash dispatched 60 at parallelism 10 in 32.4 s (ideal 30 s), where Vercel Queues took 129 s, and 500 at parallelism 100 in 27.3 s (ideal 25 s). Details are in [docs/grade-queue-options.md](../../docs/grade-queue-options.md). `handleGradeJob` does not know which queue drives it; `QStashQueue` is a thin adapter.

**Load tests never spend money.** A grade whose class session carries a `loadTestRunId` (read into `GradingInput` at claim time) is graded by `LoadTestModelClient` (the mock), whatever `MODEL_CLIENT` the deploy uses. Its call-log rows carry the run id, so they can be excluded from reports and deleted after the run.

## Wiring it into the app

The routes belong to `apps/web`. What they need:

```ts
// apps/web: shared pieces
const qstash: QStashQueue.QStashConfig = {
  token: Redacted.make(process.env.QSTASH_TOKEN),
  baseUrl: process.env.QSTASH_URL,
  currentSigningKey: Redacted.make(process.env.QSTASH_CURRENT_SIGNING_KEY),
  nextSigningKey: Redacted.make(process.env.QSTASH_NEXT_SIGNING_KEY),
  consumerUrl: `${appUrl}/api/grader/consume`,
  parallelism: 100,
};
const publish = QStashQueue.makePublish(qstash);
export const gradeQueue = QStashQueue.makeQueue(publish); // provide as Consumer.GradeQueue

// POST /api/grader/consume
const runtime = ManagedRuntime.make(
  Consumer.ModelRouterLive.pipe(
    Layer.provideMerge(Layer.mergeAll(GradeStore.postgres, Layer.succeed(Grader.Grader, Grader.placeholder))),
    Layer.provide(Layer.mergeAll(ModelClientLive, LoadTestModelClientLive, CallLogLive)),
    Layer.provide(DatabaseLive), // from @goblins/domain
  ),
);
export const POST = QStashQueue.makeHandler({ runtime, verify: QStashQueue.makeVerify(qstash), publish });

// POST /api/grader/sweep: verify the QStash signature, then
//   sweepStuckGrades({ queuedFor: Duration.minutes(3), limit: 500 })
// with GradeStore.postgres and gradeQueue. Run once per deploy:
//   QStashQueue.ensureSweepSchedule(qstash, `${appUrl}/api/grader/sweep`)
```

The consumer route needs `maxDuration` of at least 120 s: one delivery's grading is capped at 100 s.

Production runs on QStash's pay-as-you-go plan (since 2026-10-15): no daily message cap, $1 per 100,000 messages. Parallelism is still the default 10 (`GRADER_PARALLELISM`); the plan allows up to 100. The sweeper runs on Vercel cron every minute (`apps/web/vercel.json`).

To run against QStash's local dev server, as the load test's local ramp does:

```sh
npx @upstash/qstash-cli dev -port 8089
# then, with the printed QSTASH_TOKEN and signing keys, start the app with:
#   GRADER_QUEUE=qstash QSTASH_URL=http://127.0.0.1:8089 GRADER_CONSUMER_URL=http://127.0.0.1:3000/api/queue/grade GRADER_PARALLELISM=100
# and check flow control end to end (60 five-second jobs at parallelism 10, about 33 s):
pnpm --filter @goblins/grader local-flow-control 60 10
```

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
