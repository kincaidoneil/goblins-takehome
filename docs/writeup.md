# Statement of confidence

> **Draft for Kincaid to edit.** Numbers in `[TBD: …]` wait on the full load-test ramp. Everything else is measured and linked.

## What the system handles today

`[TBD: The grading pipeline holds N students in one testing window (classes of 30 starting within 2 minutes of the bell, 9 submissions each) with no lost submissions, submit p99 under 1 s and grades on the teacher's dashboard within 30 s at p95. Link the ramp report.]`

What is measured so far. Every run below mocked the model with the guessed `seed` latency profile (median 3.5 s, p95 9 s, about 1.2% errors), not the profile measured from 1,839 real Haiku calls. Reruns with the measured profile are pending.

| Run | Where | Students | Lost | Submit p99 | Dashboard p95 | Failed grades | Result |
|---|---|---|---|---|---|---|---|
| [smoke-production](../packages/loadtest/reports/smoke-production/report.md) | Production: Vercel Functions, QStash free plan, Neon, Electric on Fly | 30 (one class), 10× pace | 0 | 0.66 s | 9.2 s | 0 | Pass |
| [local-app-3classes](../packages/loadtest/reports/local-app-3classes/report.md) | Production build on a laptop, in-process queue | 90, 20× pace | 0 | 1.38 s | 5.9 s | 0 | Fail: submit p99 |
| [ramp-local-qstash](../packages/loadtest/reports/ramp-local-qstash/report.md) | Production build as ONE Node process on a laptop, QStash dev server at parallelism 100 | 990, 4× pace | 0 | 49.5 s | 254 s | 0 | Fail: submit p99 (database waits), dashboard p95 (sync) |

Nothing was lost in any run. The 990-student step failed because one local Node process served every request, where Vercel runs many instances. It says where a single instance saturates, not what the deployed system holds.

Notes on the smoke test:

- Its target, `goblins-takehome-gathers.vercel.app`, is another domain of the same Vercel project as `goblins-takehome-three.vercel.app`.
- Its header lists Blob, but the commit it ran (`3a7ad4a`) already included #70, which stores whiteboards inline as `data:` URLs in Postgres. Whiteboards went to Postgres, not Blob.

Two limits apply to production as it is deployed now, separate from what the ramp measures:

- **QStash is on the free plan, and that is the first limit we'd hit.** It allows 1,000 messages a day, about three classes of 30, and 10 grades in flight. In the smoke test, grades in flight peaked at exactly 10. At Haiku's 4.5 s median, that is about 2 grades a second. Moving to pay-as-you-go (parallelism 100, $1 per 100,000 messages) is the first step toward real scale. We didn't make that switch for the review window.
- **The ramp runs on one machine, not on Vercel.** Vercel permits load tests only on Enterprise plans and blocks unannounced traffic. So the ramp drives the production build locally with only the model mocked, and production gets the one-class smoke test above. The same command runs against Vercel with `--i-have-vercel-approval`.

## Where we deviate from the brief

The brief says the student sees their score after each problem. In the smoke test, 4% of grades arrived during the 1.5 s transition to the next problem. The rest fill in on the progress strip a few seconds later. This is deliberate: grading takes 4.5 s at the median, and students should never wait on the grader.

## Ship or no ship

The criteria were set in the [PRD](prd.md#quality-bar) before the first run.

| Criterion | Bar | Result at capacity |
|---|---|---|
| Lost submissions | 0 | `[TBD]` |
| Submit latency p99 | < 1 s | `[TBD]` |
| Submit to grade on dashboard, p95 | < 30 s | `[TBD]` |
| Grades that fail, normal conditions | < 0.1% | `[TBD]` |
| Grades that fail, provider down for 5 minutes | 0% | `[TBD]` |

Ship means capacity of at least 1,000 students in one testing window.

`[TBD: the call. Draft if the ramp clears 1,000: "Ship, with QStash moved to pay-as-you-go first. On the free plan, production serves about three classes a day." If it doesn't: name the step, the criterion and the component that failed first, and the fix.]`

## Cost

From the [eval report](../packages/evals/REPORT.md), on Claude Haiku 5.5:

- **$0.00057 per grade**, retries included, against a $0.001 target. Setting up a worksheet costs about $0.016 more (extraction and a few chat edits).
- **$3.30 per teacher per month** for a teacher with 130 students grading one 10-problem assignment a week. For a free growth product this is an acquisition cost, and it's under the $5 target.
- **Fixed infrastructure is small.** Electric on Fly costs about $7 a month. QStash adds about $0.00002 per grade (a publish and a delivery). Neon and Vercel run on plans we already have.

The accuracy behind that price: 96% of grades match the correct score, and 7% go to the teacher. The dataset is generated handwriting, so read 96% as an upper bound.

## What changes at each scale

Peak load assumes every student tests in the same 30-minute window, which overstates real schools by about 6×.

| Students | Model cost a month | Peak grades/s | What changes |
|---|---|---|---|
| 1,000 | $25 | 6 | QStash to pay-as-you-go; about 25 model calls in flight, within one provider's default limits. `[TBD: what else changes, from the capacity reruns. The single-process local ramp at 990 students failed first on database waits and sync.]` |
| 10,000 | $254 | 56 | About 250 calls in flight. QStash caps parallelism at 100 per key, so shard grades across several flow-control keys. Raise the model's rate limits and fail over to GPT-6 Luna on rate limits. Move whiteboards out of Postgres, where they are stored inline as `data:` URLs (about 6 GB a month at this size), into object storage. Add Electric machines: one Fly machine is capped at 10,000 connections and each student holds two. |
| 100,000 | $2,500 | 560 | Model cost now matters. Cache the prompt prefix shared by every student on a problem (about a fifth of the cost), trim the per-line evidence text (output is almost half the cost), and send a smaller image. Put Electric behind a CDN, which its HTTP shapes allow. A larger Postgres for about 1,700 writes a second. |
| 1,000,000 | $25,000 | 5,600 | 1.2 billion tokens a minute at peak is beyond any single provider. Route across several providers and negotiate contract pricing. Replace QStash with a queue built for this rate, such as SQS. Partition grades by district. Self-hosting an open model is the alternative, but the open models we tested are not accurate enough yet. |

Past 10,000 students, model cost and provider capacity limit us before our own infrastructure does, as the PRD expected.

## What we haven't verified

- **Real handwriting.** Every accuracy number comes from generated whiteboards.
- **The full ramp on Vercel itself.** We ran it on a production build locally because of Vercel's policy.
- **The real model under load.** The load-test runs so far used the guessed `seed` latency profile. A profile measured from 1,839 real Haiku calls (made at 8 in flight) exists, but the reruns with it are pending. How OpenRouter and Anthropic behave at 100 or 250 in flight is untested.
