# Goblins Grader

Kincaid O'Neil

**[Live app](https://goblins-takehome-three.vercel.app)** · [Sample report](https://goblins-takehome-three.vercel.app/report/demo)

[![Walkthrough](https://img.youtube.com/vi/mQDi1DlVHp0/maxresdefault.jpg)](https://youtu.be/mQDi1DlVHp0)

I tried to do two things well:

1. Orienting agents around the business goal: get teachers using the free auto-grader, then into Goblins, with a report they can use to pitch their administrators or district on Goblins with feedback on. For students, it should feel low-stakes and fun: creature avatars, no red marks, and no waiting on the grader.
2. Splitting work into parallel streams, so each session can deliver a higher level of quality and polish within the time constraints.

I drafted the [PRD](docs/prd.md), which fleshed out more detailed descriptions of key user flows, some technical decisions, and importantly, suggested sequencing and splitting of work.

The live app uses TanStack Start deployed on Vercel, with Neon Postgres, Electric for real-time sync hosted on Fly.io, Clerk for teacher auth (no student auth), Upstash QStash for queueing grade jobs, and OpenRouter for model calls. Server code uses Effect. It's a pnpm monorepo with Playwright E2E tests and a Storybook for the UI components.

### How I split the work

I designed tasks so different sessions could independently work on them. Here's an example of separate streams:

1. **Generating evals**: collecting real worksheets and synthetically generating "gold" eval cases with handwriting fonts. (Obviously, real world examples are ultimately better!)
2. **Inference engineering**: building and optimizing the grader pipeline around cost and eval performance, varying models and prompts, and projecting its economics.
3. **Load testing**: test with mocked inference responses/failures and timing. I suggested:
   1. Use some synthetic scenarios: provider downtime, some latency distribution, % of requests failing (the agent later expanded upon this)
   2. Capture *real* model request latency and failures that can then be replayed to test load

### Results

#### Accuracy and cost

An agent compared eight cheap vision models across three prompt versions and chose Claude Haiku 5.5, which grades straight from the whiteboard image. On 230 synthetic submissions it matched the intended score about 95% of the time, at about $0.00057 a grade. The handwriting was generated from fonts, so I'd expect lower accuracy on submissions from real students.

Assuming 130 students and one 10-problem assignment a week, that's roughly $3.30 per teacher a month. Multiplied by the average number of teachers it takes to land a district account and the months each teacher uses it, that's this feature's contribution to CAC.

[Eval report](packages/evals/REPORT.md)

#### Load

Each submission is saved to Postgres, then published to Upstash QStash, which calls a Vercel Function to grade it. QStash caps how many grades run at once, to stay under the model provider's rate limits, and retries failed calls, so a model outage delays grades instead of failing them. Delivery is at-least-once, so a grade is only written if its attempt is still current, and grading a submission twice changes nothing. A cron job re-sends any grade that gets stuck.

The load test runs simulated classes through the real app, queue, database and sync, with only the model mocked so it's free to re-run. On my machine, 510 students passed every bar I set beforehand (nothing lost, submit p99 under 1 s, grades reach the teacher's dashboard within 30 s at p95, under 0.1% of grades failing). Nothing was lost or failed even through a model outage. It's built to run against production: the same command takes the deployed URL, and a load-test token routes those requests to the mock model and tags their data so it stays out of real dashboards. But when I ran it, production's QStash was on the free plan, which allows 1,000 grade messages a day (a 510-student run sends about 4,600), so production ran one class of 30. That leaves 1,000 students and real provider behavior at scale unverified.

**Ship call:** ship. At the highest load one machine could generate (510 students at 4× pace, the submit rate of about 2,000 real students), nothing in the implementation failed. Scaling from here is a serving change, not a code change: QStash's paid plan runs 100 grades at once, about 23 a second, against about 6 a second for a 1,000-student testing day; Vercel Functions scale out on their own; Electric and Postgres scale by adding machines. Before a large rollout, I'd confirm it with a 1,000-student run on paid production infrastructure, generating the load from several machines.

Past 10,000 students, scaling is mostly serving and contracts, not code: raise the queue's parallelism, get an enterprise agreement with the model provider for higher rate limits (plus a second provider for failover), and add Electric and Postgres capacity. Live sync is the part to watch: Electric broke first in our 990-student runs, and fixing it took per-student subscriptions and raised connection limits. At scale it needs more Electric machines and a CDN in front of them. Model cost grows linearly, at about $0.025 per student a month, so it's a budget decision, though at 100,000 and up it's worth cutting with prompt caching and shorter output. The [statement of confidence](docs/writeup.md) covers what changes at each step, from 1,000 to 1M students.

### Deferred

- **Reusing an assignment.** Setup leads straight to launch, so a teacher can't save an assignment or relaunch it for another class. The data model already supports it.
- **Real handwriting in the evals.** Every accuracy number comes from generated whiteboards.
- **Student identity and class management.** There are no student accounts or rosters. Students join with a code and a typed name, so anyone with the code can join (up to 60 per class), and a student can resume as someone else by typing their name. The teacher in the room is the only check. Real student identity (Google, Clever) and class rosters that carry across assignments come next.
- **Gating on setup.** Worksheet upload and chat editing need no sign-in, so anyone can spend model calls on them. They're limited only by per-IP and per-draft rate limits (5 uploads and 30 chat messages an hour) and a $3 spend cap on setup. A real launch needs sign-in or per-account quotas there.

### Run it

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

# Load test against production: one class of 30, with the deploy's load-test token.
# More classes need --i-have-vercel-approval and QStash on a paid plan.
LOAD_TEST_TOKEN=<token> pnpm --filter @goblins/loadtest loadtest scenario normal \
  --url https://goblins-takehome-three.vercel.app --start-classes 1 --time-scale 0.1
```
