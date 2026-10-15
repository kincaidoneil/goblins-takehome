# Load-test reports

One folder per run: `report.md` (read this), `report.json` (everything), and raw `*.ndjson` events (not committed). `ledger.json` records the estimated QStash spend of every charged step against the $25 cap.

| Run | Target | What it shows |
|---|---|---|
| [dryrun-standin-3classes](dryrun-standin-3classes/report.md) | The local **stand-in** (not the app): in-memory queue, not QStash; Postgres and Electric in Docker on a laptop | The harness end to end at 90 students, 20× the testing-day rate. Its failures describe the stand-in and the laptop, not the app. |
| [local-app-3classes](local-app-3classes/report.md) | The **real app** (production build, `NODE_ENV=production`) on a laptop, Postgres and Electric in Docker. Its queue is the app's inline in-process queue, since QStash runs only in a Vercel production deploy. The inline mock grades by student name, not by whiteboard, hence "grades in a state the fixture does not predict". | 90 students at 20× the testing-day rate: 0 lost, dashboard p95 5.9 s, submit p99 1.38 s (fails the 1 s bar). |
| [qstash-smoke-local](qstash-smoke-local/report.md) | The real app's production build (one Node process) on a laptop, grading through **QStash's local dev server** (parallelism 100) and the real consumer, mock model `seed` profile | 30 students at 20× rate: 0 lost, 0 fixture mismatches, dashboard p95 9.8 s, submit p99 2.0 s (FAIL). |
| [smoke-production](smoke-production/report.md) | **Vercel production**: Functions, Blob, cloud QStash (free plan, parallelism 10), self-hosted Electric; mock model `seed` profile | One class of 30 at 10× rate: **PASS** on every criterion. Submit p99 0.66 s, dashboard p95 9.2 s, 0 lost, 0 failures, 0 fixture mismatches. In-flight grades peaked at 10, the QStash free plan's parallelism. |
