# Goblins Grader

Live: [goblins-takehome-three.vercel.app](https://goblins-takehome-three.vercel.app) · [sample report](https://goblins-takehome-three.vercel.app/report/demo) · [shared view](https://goblins-takehome-three.vercel.app/share/demo)

## How I approached it

- **The PRD and the agent setup came first.** I wrote a [PRD](docs/prd.md) with the user flows, the ship / no-ship criteria, and how the agents would be organized. Then I oversaw the build. One orchestrator Claude session ran about a dozen Claude Code workstreams in parallel, each owning one package. Every change was a small PR merged on green CI and E2E. I made the calls: scope, vendors, spend, eval ground truth, and the changes of course logged in [decisions.md](docs/decisions.md).
- **Evals and inference were separate, parallel workstreams, measured before chosen.** One stream compared eight cheap vision models on 230 generated whiteboards. Others built the grading queue, a free mock of the model, the class simulator and the load test. Claude Haiku 5.5 won: it gives the score a careful teacher would 96% of the time and sends 7% to the teacher, at $0.00057 a grade, or $3.30 per teacher a month ([eval report](packages/evals/REPORT.md)). The whiteboards are generated handwriting, so 96% is an upper bound.
- **Everything serves the business goal: getting teachers into Goblins.** Goblins keeps students once a teacher assigns work, and teachers stall before the first assignment. So the landing page takes the worksheet a teacher already has, with no sign-up until launch. The report shows where the class struggled, offers one click to give exactly those students practice in Goblins, and makes a name-free link to share with administrators.

## Notable things

- **The dashboard updates live, with Electric.** Every submission and grade streams from Postgres to the teacher's dashboard, the projector and each student's progress strip through Electric. We run Electric ourselves on Fly, because Electric Cloud [is winding down](https://electric.ax/blog/2026/08/11/electric-joining-databricks). Writes go through server functions, and a server proxy decides who can read which rows.
- **When the grader isn't sure, the teacher decides.** Cheap models don't give calibrated confidence scores, so the grader doesn't report a number. It reports marks it couldn't read and answers that conflict, and code turns either into a flag. A flagged grade goes to the teacher with the grader's best guess and its reason. In the evals, the grader flagged 13 of 25 ambiguous submissions, with 1 false flag in 170 clear ones.
- **Students never wait on the grader.** The brief says a student sees their score after each problem. Grading takes 4.5 s at the median, so the student moves straight on to the next problem and the score fills in on the progress strip a few seconds later. About 4% of grades arrive during the 1.5 s transition.

## Load testing

`[TBD: capacity and the ship call, once the reruns land.]` So far nothing has been lost at any load, and the first thing to break past one class is live sync, not grading.

**How it works.** The test recreates a testing day: classes of 30 start within 2 minutes of the bell, and each student makes 9 submissions. Simulated students and teachers use the app's real HTTP routes and Electric subscriptions, as browsers do. Only the model is mocked, so a run costs nothing. The steps grow until a ship / no-ship criterion fails. The criteria, set before the first run: no lost submissions, submit p99 under 1 s, grades on the dashboard within 30 s at p95, and under 0.1% of grades failing. Vercel allows load tests only on Enterprise plans, so the ramp runs against the app's production build on one machine, and production got a one-class smoke test. Every run so far used a guessed model latency profile (median 3.5 s); reruns with the profile measured from 1,839 real Haiku calls are pending.

| Run | Students | Lost | Submit p99 | Dashboard p95 | Result |
|---|---|---|---|---|---|
| [Production smoke test](packages/loadtest/reports/smoke-production/report.md), the deployed stack | 30 | 0 | 0.66 s | 9.2 s | Pass |
| [Local, one app process](packages/loadtest/reports/ramp-local-qstash/report.md) | 990 | 0 | 49.5 s | 254 s | Fail: one process saturates |
| [Local, six app processes](packages/loadtest/reports/ramp-local-6workers/report.md) | 990 | 0 | 5.8 s | 49 s | Fail: sync accounts for 44 s of the dashboard time |

No grade failed in any run. With six processes, grades waited 1.3 s in the queue at p95 and 7.8 s at most. The bottleneck is the live subscriptions: each student holds their own, and Electric falls behind serving them all.

**The first limits in production.** QStash is on its free plan: 1,000 messages a day, about three classes, and 10 grades in flight. Moving to pay-as-you-go (100 in flight) is the first step for real use. After that comes sync: share one subscription per class instead of one per student, and add Electric machines.

**At larger scale,** model cost and provider capacity limit us before our own infrastructure does. Peak numbers assume everyone tests in the same 30 minutes.

| Students | Model cost a month | Peak grades/s | What changes |
|---|---|---|---|
| 1,000 | $25 | 6 | QStash pay-as-you-go; sync fixes from the ramp |
| 10,000 | $254 | 56 | Shard the queue past 100 in flight; raise the model's rate limits and fail over to GPT-6 Luna; move whiteboards to object storage; several Electric machines |
| 100,000 | $2,500 | 560 | Cut model cost: cache the shared prompt prefix, shorten output, send smaller images; Electric behind a CDN; a larger Postgres |
| 1,000,000 | $25,000 | 5,600 | Several model providers and contract pricing; a queue built for this rate; partition by district |

## Deferred

- **Real handwriting in the evals.** The dataset is generated from handwriting fonts; I didn't have time to draw the planned check set.
- **Rubric questions.** Grouping a problem's flagged grades into one question for the teacher ("5 students left 6/8 unsimplified; full credit?"). The flag already gets the teacher there.
- **The full ramp on Vercel.** It needs an Enterprise plan. The runner supports it with one flag.
- **A real Goblins handoff.** Goblins has no public API, so the CTA opens a labeled demo screen and links to Goblins onboarding.

## Run it

Needs Node 22, pnpm and Docker. Run `pnpm install` first.

```bash
# The app at http://localhost:3000, with the mock model and no sign-in
pnpm --filter @goblins/web db:up && \
  DATABASE_URL=postgres://postgres:postgres@localhost:55432/goblins pnpm --filter @goblins/domain db:migrate && \
  pnpm --filter @goblins/web dev

# E2E, against a production build as CI runs it
pnpm --filter @goblins/web build && (cd apps/web && PORT=3000 node --env-file=local.env .output/server/index.mjs &)
pnpm --filter @goblins/e2e exec playwright install chromium
E2E_BASE_URL=http://localhost:3000 pnpm e2e

# Evals, rebuilt from cached responses at no cost
pnpm --filter @goblins/evals eval:tables anthropic/claude-haiku-5.5

# Load test: start the production build as in packages/loadtest/README.md, then
LOAD_TEST_TOKEN=local pnpm --filter @goblins/loadtest loadtest ramp --url http://localhost:3290 --pricing none
```
