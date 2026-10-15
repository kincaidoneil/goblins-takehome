# @goblins/grader

The grading pipeline. A student's submission becomes a queue message, a Vercel Function grades it with one model call, and the grade lands in Postgres in one of the PRD's states. Every model call is logged with its latency, status, tokens and cost.

```
submit (apps/web)                      Vercel Queues, topic "grade"             consumer (this package)
───────────────────                    ────────────────────────────             ───────────────────────
insert grade, state submitted ──┐      at-least-once, 7-day retention,          load grade ─ stale or done? ─▶ ack
commit                          └─▶    dedupe on grade:<id>:<attempt>,  ──▶     mark grading
send { gradeId, attempt }              maxConcurrency in-flight cap             grade(problem, rubric, whiteboard, deps)
                                                                                 ├─ ok ─▶ graded / needs_teacher ─▶ ack
cron, every minute: re-send grades                                               ├─ transient error ─▶ redeliver after backoff
stuck in submitted/grading > 3 min                                               └─ retries exhausted ─▶ couldnt_grade ─▶ ack
```

## Modules

| Module | What it does |
| --- | --- |
| `ModelClient` | The one interface for model calls. Mock (`packages/mock-model`) and OpenRouter implementations. |
| `OpenRouter` | The real client. Dies at build time unless `MODEL_CLIENT=openrouter`. |
| `CallLog` | Wraps any client so every call is timed and recorded. |
| `Grader` | The seam the AI-quality stream fills: `grade(input) → Graded \| NeedsTeacher`, or a `ModelError`. `placeholder` is a single-call stand-in. |
| `GradeStore` | Conditional reads and writes on the grade row. In-memory now; Postgres once the domain schema lands. |
| `Consumer` | `handleGradeJob(job, delivery) → Done \| RetryLater`, the model router for load tests, and the stuck-grade sweeper. |
| `RetryPolicy` | The pure rule for retrying or giving up. |
| `VercelQueue` | Sends jobs and adapts push deliveries to `handleGradeJob`. |
| `InProcessQueue` | Local and test stand-in with the same cap, redelivery and dedupe. |

## How it holds up

**No lost submissions.** The submit path commits the grade row before it sends the job. If the send fails or the function dies in between, the grade sits in `submitted`; the sweeper finds anything untouched for 3 minutes and sends it again. Resending is safe because the queue dedupes on `grade:<id>:<attempt>`. Messages are kept for 7 days, so a broken consumer deploy delays grades until it is fixed rather than dropping them overnight.

**Idempotent writes.** Delivery is at-least-once. Each message carries the grade's `attempt`, and every write is conditional on the row still being open (`submitted` or `grading`) for that attempt. A duplicate delivery, a delivery that arrives after a teacher's retry, and two deliveries racing each other all end with exactly one written grade. Tests cover each case.

**Retries.** Rate limits, timeouts, 5xx and dropped connections are retried by the queue, not in a loop inside the function, so a waiting grade holds no concurrency slot. Backoff is 2 s, 4 s, 8 s … capped at 60 s, with ±20% jitter so a burst of failures does not retry in lockstep, and never shorter than the provider's `Retry-After`. Unusable answers (malformed JSON, cut off) are retried immediately inside the same delivery, three tries in all. Errors that retrying cannot fix, such as a 400 or 402 (out of credits), fail at once.

**A 5-minute outage delays grades and fails none.** Transient errors keep retrying until a grade has waited 15 minutes, three times the outage the PRD asks us to absorb. Because backoff is capped at 60 s, grades resume within about a minute of the provider coming back. After 15 minutes the grade becomes `couldnt_grade`, and the teacher can retry it or score it.

**Concurrency cap.** `maxConcurrency` on the queue trigger limits model calls in flight. It protects the provider's rate limits, our database connections and the budget. OpenRouter sets no request cap on paid models, so the binding limits are the upstream provider's and our own. Start at 100: by Little's law, with about 4 s per call, 100 in flight sustains 25 grades/s. A testing day of 1,000 students (10 submissions each over 30 minutes) averages about 6 grades/s, and the bell spike runs perhaps three times that. The load test finds the real limit.

**Load tests never spend money.** A grade whose row carries a `loadTestRunId` is graded by `LoadTestModelClient` (the mock), whatever `MODEL_CLIENT` the deploy uses. Its call-log rows carry the run id, so they can be excluded from reports and deleted after the run.

## Wiring it into the app

The consumer route, `vercel.json` and the cron belong to `apps/web` and Infra. What they need:

```ts
// apps/web: the queue consumer route
const runtime = ManagedRuntime.make(
  Consumer.ModelRouterLive.pipe(
    Layer.provideMerge(Layer.mergeAll(GradeStoreLive, Layer.succeed(Grader.Grader, Grader.placeholder))),
    Layer.provide(Layer.mergeAll(ModelClientLive, LoadTestModelClientLive, CallLogLive)),
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

`maxDeliveries` is a backstop for crashes (defects the consumer does not model, which the adapter redelivers every 10 s). The 15-minute retry budget needs about 20 deliveries, so 40 never cuts a modeled retry short.

`maxConcurrency` on a `queue/v2beta` trigger is accepted by Vercel's build schema (`@vercel/build-utils`, 1 to 8192) but is not yet in the `vercel.json` docs. Confirming that it holds on the real deploy is an open task.

## Tests

```sh
pnpm --filter @goblins/grader test
```

The consumer tests run the in-process queue, the consumer, the placeholder grader, the call log and the in-memory store against a scripted model, on virtual time. They cover:

- the concurrency cap
- retries with backoff
- a 5-minute outage that delays grades and fails none
- giving up after 15 minutes
- unusable answers
- duplicate, racing and stale deliveries
- a teacher acting mid-grade
- load-test routing
- the sweeper
- a database outage during the grade write
