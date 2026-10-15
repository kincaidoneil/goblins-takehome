# Load-test reports

One folder per run: `report.md` (read this), `report.json` (everything), and raw `*.ndjson` events (not committed). `ledger.json` records the estimated QStash spend of every charged step against the $25 cap.

| Run | Target | What it shows |
|---|---|---|
| [dryrun-standin-3classes](dryrun-standin-3classes/report.md) | The local **stand-in** (not the app): in-memory queue, not QStash; Postgres and Electric in Docker on a laptop | The harness end to end at 90 students, 20× the testing-day rate. Its failures describe the stand-in and the laptop, not the app. |
