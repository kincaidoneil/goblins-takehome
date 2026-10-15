# @goblins/loadtest

The PRD's testing-day load test: classes of 30 start within 2 minutes of the bell, each student makes 9 submissions over 20–40 minutes, and dashboards and progress strips stay subscribed throughout. The test ramps in class-sized steps until a ship / no-ship criterion fails, and writes a Markdown and JSON report naming the step and the component that failed first. Only the model is mocked.

The client is [`@goblins/simulator`](../simulator): every simulated student and teacher uses the app's real HTTP routes and its Electric shapes, as a browser does.

## Run it

```bash
# Against the local stack (Postgres, Electric, and a stand-in for the app's routes; see below)
pnpm --filter @goblins/loadtest stack:up
DATABASE_URL=postgres://postgres:postgres@localhost:55433/goblins pnpm --filter @goblins/domain db:migrate
LOAD_TEST_TOKEN=local pnpm --filter @goblins/loadtest standin      # leave running
LOAD_TEST_TOKEN=local pnpm --filter @goblins/loadtest loadtest ramp --start-classes 2 --max-steps 1 --time-scale 0.05

# Against the real app's production build on this machine (what our reports use)
pnpm --filter @goblins/web build
LOAD_TEST_TOKEN=local NODE_ENV=production PORT=3290 AUTH_MODE=local \
  DATABASE_URL=postgres://postgres:postgres@localhost:55433/goblins ELECTRIC_URL=http://localhost:30002 \
  STUDENT_COOKIE_SECRET=local node --env-file=.env.local apps/web/.output/server/index.mjs
LOAD_TEST_TOKEN=local pnpm --filter @goblins/loadtest loadtest ramp --url http://localhost:3290 --pricing none

# Several app processes on one port, as a rough stand-in for several Vercel instances
WORKERS=6 SERVER_ENTRY=$PWD/apps/web/.output/server/index.mjs NODE_ENV=production PORT=3290 … node packages/loadtest/scripts/cluster.mjs

# Smoke test against a deploy: one class of 30, same command and report
LOAD_TEST_TOKEN=<token> pnpm --filter @goblins/loadtest loadtest scenario normal --url https://<app> --start-classes 1 --time-scale 0.1
```

The target is only a URL: a local build and a Vercel deploy run the same scenario, metrics and report. More than one class against a non-local URL requires `--i-have-vercel-approval`.

## Running the full ramp on Vercel

We do not run it ourselves: Vercel [permits load tests only on Enterprise plans](https://vercel.com/kb/guide/what-s-vercel-s-policy-regarding-load-testing-deployments), with notice given through a Vercel representative (test window, peak requests per second, hostnames, source IPs), and blocks the source IPs of unannounced tests. Someone with that approval runs:

```bash
LOAD_TEST_TOKEN=<the deploy's token> pnpm --filter @goblins/loadtest loadtest ramp \
  --url https://<app> --i-have-vercel-approval --queue "QStash, parallelism 100"
```

Prerequisites:

- The deploy has `LOAD_TEST_TOKEN` set; requests carrying it are routed to the mock model and their data is tagged and deleted after each step.
- The QStash resource is on pay as you go (the free tier allows 1,000 messages a day and parallelism 10).
- Expected cost: QStash about $1 per 100,000 deliveries, so about $0.13 for the 990-student step and about $1.70 for six steps; the runner stops before its ledger passes $25. On Vercel Pro, usage past the included amounts (function invocations and CPU, Blob operations) is billed; load-test whiteboards are stored once per content hash per instance, so Blob writes stay in the tens per step.

Known deployed limits on our plan (Pro): the policy above, Vercel's limit on how fast new function instances start (1,000 per 10 s), and Blob's per-second upload rate. Enterprise lifts the policy and the concurrency defaults.

`--pricing` defaults to `qstash` (charged against the ledger) for every target except the stand-in.

Reports land in `packages/loadtest/reports/<run-id>/`: `report.md`, `report.json`, and one `<run-id>-s<step>.ndjson` of raw events per step (git-ignored).

| Command | What it does |
|---|---|
| `loadtest ramp` | Steps of 33, 50, 67, … classes (990, 1,500, 2,010 … students) until a criterion fails, the generator limits itself, or `--max-steps` |
| `loadtest scenario <name>` | One step at `--start-classes` under a mock scenario: `rate-limit-storm`, `provider-down`, `latency-doubling`, `replay` |
| `loadtest cleanup <run-id>` | Deletes an interrupted run's data |

`--time-scale 0.1` compresses every interval tenfold. That multiplies the submission rate by ten, so a compressed step is heavier than a real testing day with the same head count; the report says so and gives the measured submit rate.

## How it works

Each step is one simulated testing window with its own run id (`<run-id>-s<n>`). Every request carries:

- `x-goblins-load-test: <LOAD_TEST_TOKEN>:<step run id>`. The app checks the token (`authorizeLoadTest` in `@goblins/mock-model`), stamps the run id on the teacher, assignment and session it creates, routes their grades to the mock model, and accepts `x-goblins-load-test-teacher: <n>` in place of Clerk sign-in.
- `x-goblins-mock-model: <spec>`, the mock's behavior for the step, anchored at the step's start so every serverless instance sees an outage at the same moment.

After the step, the runner reads per-submission pipeline timestamps from `/api/load-test/runs/<id>/timings`, deletes the run's data through `/api/load-test/runs/<id>/cleanup` (domain's `deleteLoadTestRun`), computes the metrics and checks the criteria. Database load comes from `/api/load-test/db`, sampled every 5 s. These routes need the token, so measuring a deploy needs no database credentials.

### What each number means

| Metric | Measured as |
|---|---|
| Submit latency | First click to the server's acknowledgment, including the client's retries. A single request's latency is reported too. |
| Submit to dashboard | First click to the teacher's dashboard shape delivering a final state. A grade that never arrives counts as infinitely late and as lost. |
| Queue wait, grading, sync lag | From server timestamps: submission stored → claimed → outcome recorded → row on the dashboard. Sync lag compares the server's clock with this machine's. |
| Queued, in flight | Grades in `submitted` and `grading` on all dashboards, summed. |
| Lost | Never acknowledged after 5 minutes of retries, or acknowledged but never final on the dashboard before the drain deadline (10 min). |
| Failures | Grades that end in "couldn't grade". |
| Transition share | Grades a student's progress strip received within 1.5 s of the acknowledgment. |
| Sync load | Shape requests by view, live long-polls, catch-up latency, errors. |
| Correctness | Each class checks its dashboard against what its students did: every student listed, every grade present and in the state the fixture predicts. 5% of students close the tab and resume on a "new device" with the name retyped. |

### Criteria

From the PRD, checked at every step. The capacity is the highest step where all hold.

| Criterion | Bar |
|---|---|
| Lost submissions | 0 |
| Submit latency p99 | < 1 s |
| Submit to grade on dashboard p95 | < 30 s |
| Grades that fail | < 0.1%; 0% under `provider-down` |

For each failed criterion the report names the component that most likely failed first (submit function, database, queue, grading, sync), inferred from errors, server timings and queue counts. It says where to look, not a proven cause.

### The mock model

Every report names the mock's latency profile. Until real calls are logged, it is the `seed` profile in `@goblins/mock-model`, which is a guess. Whiteboards are the mock's fixtures, so each grade is predictable and checked.

## The load generator's limits

One Node process drives every simulated person. Each student holds two long-polls open; each teacher three. A generator that runs out of CPU, or whose event loop stalls, reports its own delay as server latency, so it samples itself every 2 s (event-loop delay p99, CPU, open requests) and marks a step **INVALID** when it is over 200 ms or 90% CPU for two samples in a row. An invalid step is not a server failure; split the load across machines to go higher.

Measured on an 8-core MacBook Pro: see `reports/` for the latest generator figures. A 990-student step peaked at about 2,000 open requests, 48% of one core and a 250 ms event-loop p99.

macOS limits open files per process (`kern.maxfilesperproc`, 61,440 here); each student uses about 2 sockets.

## The stand-in

`src/standin/` serves the same HTTP contract on the real domain package, local Postgres and local Electric, with the mock model and a grading worker that follows the grading pipeline's retry policy (15 minutes of retries, backoff 2 s to 60 s). It lets the load test run before the app's routes exist, and it is a reference implementation of the contract. It accepts only load-test traffic and is never deployed. Its numbers describe the stand-in, not the app.

| Env | Default |
|---|---|
| `PORT` | 3190 |
| `DATABASE_URL` | the compose Postgres on 55433 |
| `ELECTRIC_URL` | the compose Electric on 30002 |
| `GRADER_CONCURRENCY` | 10 |
| `DB_POOL` | 20 |

## Tests

```bash
pnpm --filter @goblins/loadtest test   # the analysis and criteria on synthetic events
```
