# Statement of confidence

## What the system handles today

**Capacity: at least 510 students in one testing window, on one laptop.** That is a floor, not Vercel's ceiling: the laptop ran the generator, Postgres, Electric and six app processes at once. At 510 students (17 classes starting within 2 minutes of the bell, 9 submissions each, at 4× the real submission rate), every criterion held ([report](../packages/loadtest/reports/after-sync-fix-510/report.md)):

- submit p99 0.38 s, peak 12.8 submits a second;
- submit to grade on the dashboard p95 18.4 s: 0.4 s in the queue, 8.1 s grading, 12.5 s of sync;
- 0 lost, 0 failed grades, and every grade matched what the whiteboard should get.

That run mocked the model with latency measured from 1,839 real Haiku calls. The earlier runs below used a guessed profile (median 3.5 s).

| Run | Where | Students | Lost | Submit p99 | Dashboard p95 | Failed grades | Result |
|---|---|---|---|---|---|---|---|
| [after-sync-fix-510](../packages/loadtest/reports/after-sync-fix-510/report.md) | Production build as 6 processes on a laptop, QStash dev server, measured profile | 510, 4× pace | 0 | 0.38 s | 18.4 s | 0 | Pass |
| [smoke-production](../packages/loadtest/reports/smoke-production/report.md) | Production: Vercel Functions, QStash free plan, Neon, Electric on Fly | 30, 10× pace | 0 | 0.66 s | 9.2 s | 0 | Pass |
| [provider-down-local](../packages/loadtest/reports/provider-down-local/report.md) | Laptop, model down for 5 minutes | 300, 2× pace | 0 | 0.62 s | 192 s | 0 | Pass on the outage bar (0 failed); grades were delayed, as expected |
| [ramp-local-6workers](../packages/loadtest/reports/ramp-local-6workers/report.md) | Laptop, 6 processes, before the sync fixes | 990, 4× pace | 0 | 5.8 s | 49 s | 0 | Fail: sync |
| [ramp-local-qstash](../packages/loadtest/reports/ramp-local-qstash/report.md) | Laptop, ONE app process | 990, 4× pace | 0 | 49.5 s | 254 s | 0 | Fail: one process saturates |

Nothing was lost in any run, and no grade failed, including during a 5-minute model outage and a rate-limit storm. The 990-student runs failed on live sync to the dashboards. The fixes have merged (one shared subscription per class, then per-student filtering, and higher Electric limits). The 990 rerun after them ([report](../packages/loadtest/reports/per-student-990/report.md)) is invalid: the laptop driving the load ran out before the system did. An earlier rerun after the first fix was invalid because of a request storm from the load generator.

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

| Criterion | Bar | At 510 students |
|---|---|---|
| Lost submissions | 0 | 0 |
| Submit latency p99 | < 1 s | 0.38 s |
| Submit to grade on dashboard, p95 | < 30 s | 18.4 s |
| Grades that fail, normal conditions | < 0.1% | 0% |
| Grades that fail, provider down for 5 minutes | 0% | 0% (at 300 students) |

Every bar held at 510 students in one testing window, measured on one laptop. 1,000 is not verified, because the laptop driving the load ran out before the system did. **Ship for testing windows up to 510 students.** A 1,000-student window needs the load split across several generator machines to verify it, plus QStash on pay-as-you-go.

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
| 1,000 | $25 | 6 | QStash to pay-as-you-go; about 25 model calls in flight, within one provider's default limits. Sync is the part to watch: 510 students pass on one laptop. |
| 10,000 | $254 | 56 | About 250 calls in flight. QStash caps parallelism at 100 per key, so shard grades across several flow-control keys. Raise the model's rate limits and fail over to GPT-6 Luna on rate limits. Move whiteboards out of Postgres, where they are stored inline as `data:` URLs (about 6 GB a month at this size), into object storage. Add Electric machines: one Fly machine is capped at 10,000 connections and each student holds two. |
| 100,000 | $2,500 | 560 | Model cost now matters. Cache the prompt prefix shared by every student on a problem (about a fifth of the cost), trim the per-line evidence text (output is almost half the cost), and send a smaller image. Put Electric behind a CDN, which its HTTP shapes allow. A larger Postgres for about 1,700 writes a second. |
| 1,000,000 | $25,000 | 5,600 | 1.2 billion tokens a minute at peak is beyond any single provider. Route across several providers and negotiate contract pricing. Replace QStash with a queue built for this rate, such as SQS. Partition grades by district. Self-hosting an open model is the alternative, but the open models we tested are not accurate enough yet. |

Past 10,000 students, model cost and provider capacity limit us before our own infrastructure does, as the PRD expected.

## Abuse limits

Setup needs no sign-in, and any Google account can sign in as a teacher, so the app limits what one visitor can spend ([security review](security-review.md), findings 1–3):

- **Setup** (#125): problem text up to 2,000 characters and 50 problems; 30 chat messages per draft, with only the last 10 turns sent to the model; per hour, 5 uploads and 30 chat messages per IP and per draft owner; and a $3 spend cap on setup calls.
- **Classes** (#123): at most 60 students per class, rate limits on joining and submitting, and at most 1,000 grades per teacher per hour. Load-test traffic with a valid token skips these limits.
- **Everything:** a global cap stops all model calls once the key has spent $20 (`MODEL_SPEND_CAP_USD`).

Not built: real accounts for students, and per-teacher billing quotas for a launch at scale.

## What we haven't verified

- **Real handwriting.** Every accuracy number comes from generated whiteboards.
- **The full ramp on Vercel itself.** We ran it on a production build locally because of Vercel's policy.
- **The real model under load.** The load-test runs so far used the guessed `seed` latency profile. A profile measured from 1,839 real Haiku calls (made at 8 in flight) exists, but the reruns with it are pending. How OpenRouter and Anthropic behave at 100 or 250 in flight is untested.
