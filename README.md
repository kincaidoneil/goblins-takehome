# Goblins Grader

A free auto-grader for math teachers. A teacher drops in the worksheet they were going to hand out anyway, students show their work on a whiteboard, and the teacher gets a graded class and a report that points the struggling students at Goblins.

Live: **https://goblins-takehome-three.vercel.app** · [sample report](https://goblins-takehome-three.vercel.app/report/demo) · [shared view](https://goblins-takehome-three.vercel.app/share/demo)

## How I approached it

**The problem first.** The brief calls this a growth product: Goblins keeps students once a teacher assigns work, but teachers stall before the first assignment. So the grader had to save a teacher real hours on something they already do, and end one click from Goblins. That framing decided what to build and what to cut.

**A spec before any code.** I wrote a [PRD](docs/prd.md) with the user flows, the decisions I didn't want reopened, and the ship / no-ship criteria for the load test, each with its reason, before anything was built or measured. Where the PRD was silent, whoever made the call logged it in [docs/decisions.md](docs/decisions.md) with one line of reasoning.

**Evidence as the bar.** Evals picked the model and what it sees. The load test, re-runnable by anyone, makes the ship call. The $20 model budget was split by use up front, and a mock model keeps tests and load tests free.

**Agents built it; I made the calls.** An orchestrator Claude session split the PRD into about a dozen parallel Claude Code workstreams, one package each, every change a small PR merged on green CI and E2E. I set scope, chose vendors, approved spend, reviewed eval ground truth the agents weren't sure of, and changed course when something failed: Electric Cloud shut down mid-build, and Vercel Queues measured 4× slower than QStash.

## Key product decisions

- **Start from the worksheet the teacher already has.** No form for typing problems; a few real worksheets cover the empty state. Sign-in comes only at launch, so a teacher sees the extracted problems and rubrics before any friction.
- **A live class session, joined like Kahoot.** A code on the projector, a first name, and the teacher in the room as the identity check. No student accounts: handing out access is exactly where teachers stall today.
- **The grader asks instead of guessing.** Every grade either stands or goes to the teacher with a reason, and the teacher always has the last word. That is what makes a cheap model trustworthy. Students see "your teacher will check this one", never an error.
- **The report is the growth loop.** It shows where the class struggled, offers one click to give exactly those students practice in Goblins, and makes a name-free link to share with colleagues and administrators.

## Technical overview

TanStack Start and Effect on Vercel, Postgres on Neon, Electric (self-hosted on Fly) for live dashboards, Upstash QStash for grading jobs, and Claude Haiku 5.5 through OpenRouter, with a mock behind the same interface.

- **The model was chosen by evals.** Eight cheap vision models graded 230 generated whiteboards. Haiku 5.5 matched the correct score most often and flagged the most ambiguous work. One call per submission beat one per rubric line, and a text description of the diagram beat sending the page image. [Eval report](packages/evals/REPORT.md).
- **A mock model makes testing free.** Its latency is sampled from real Haiku calls and it can replay outages and rate-limit storms, so E2E, the class simulator and the load test cost nothing to repeat.
- **The queue was chosen by measurement.** At a concurrency cap of 10, QStash ran 60 five-second jobs in 32 s; Vercel Queues took 129 s. [Comparison](docs/grade-queue-options.md).
- **No grade is lost.** Grade writes are idempotent per attempt, a claim lease stops duplicate model calls, and a sweeper re-sends anything stuck.
- **The load test runs on a local production build.** Vercel allows load tests only on Enterprise plans, so the full ramp runs the app's production build against Postgres and Electric on one machine, and production gets a one-class smoke test through the same command.

## Results

- **Accuracy:** 96% of grades match the correct score; 7% go to the teacher. Measured on generated handwriting, so treat it as an upper bound.
- **Cost:** $0.00057 per grade, about half the $0.001 target: $3.30 a month for a teacher with 130 students grading one 10-problem assignment a week.
- **Load:** capacity pending the full ramp. So far: 90 students at 20× testing-day pace, 0 lost, grades on the dashboard at p95 5.9 s. [Load-test reports](packages/loadtest/reports/README.md).

## Deferred

- **Rubric questions.** Grouping a problem's flagged grades into one question for the teacher ("5 students left 6/8 unsimplified; full credit?"). The flag already gets the teacher there; grouping is polish.
- **Real handwriting in the evals.** The dataset is generated from handwriting fonts; I didn't have time to draw the planned check set.
- **The full ramp on Vercel.** It needs an Enterprise plan and QStash pay-as-you-go. The runner supports it with one flag.
- **A real Goblins handoff.** Goblins has no public API, so the CTA opens a labeled demo screen and links to Goblins onboarding.
- **Grade export and share-link revocation.** Worth building once teachers come back for a second assignment.

## Run it

Needs Node 22, pnpm and Docker. Run `pnpm install` first.

```bash
# The app, at http://localhost:3000 (Postgres and Electric in Docker, mock model, no sign-in needed)
pnpm --filter @goblins/web db:up && \
  DATABASE_URL=postgres://postgres:postgres@localhost:55432/goblins pnpm --filter @goblins/domain db:migrate && \
  pnpm --filter @goblins/web dev

# E2E, against a production build as CI runs it (the dev server is too slow for the tests' timeouts)
pnpm --filter @goblins/web build && (cd apps/web && PORT=3000 node --env-file=local.env .output/server/index.mjs &)
E2E_BASE_URL=http://localhost:3000 pnpm e2e

# Evals: rebuilds the tables from cached responses, at no cost
pnpm --filter @goblins/evals eval:tables anthropic/claude-haiku-5.5

# Load test: see packages/loadtest/README.md to start the production build, then
LOAD_TEST_TOKEN=local pnpm --filter @goblins/loadtest loadtest ramp --url http://localhost:3290 --pricing none
```
