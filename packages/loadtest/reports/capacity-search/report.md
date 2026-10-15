# Load test capacity-search

| | |
|---|---|
| Target | http://localhost:3290 |
| Started | 2026-10-15T17:34:07.384Z |
| Commit | `cd7b05a` |
| Scenario | normal |
| Mock model | `claude-haiku-5.5` profile: measured from 1,839 real grading calls (p50 3.9 s, p95 8.0 s, p99 11.4 s; no failures in the sample, measured at 8 concurrent calls) |
| Mock spec | `mode=sampled; profile=claude-haiku-5.5; start=<step start>` |
| Queue | QStash local dev server, flow control parallelism 100; the app as 6 Node processes on one port (scripts/cluster.mjs), sharing an 8-core laptop with the generator, Postgres and Electric 1.8.1 |
| Assignment | angle-relationships, 9 submissions per student |
| Time scale | 0.25 (each student's 20–40 min working window × 0.25; the 1-minute lobby and 2-minute bell spread run at real time; submission rate ≈ 4.0× a real testing day with the same head count) |
| Load generator | one Node v22.22.0 process on macbookpro.lan (8 CPUs, 16 GB) |

## Result

Every criterion held up to **30 students**.

Stopped because: the run is still in progress.

## Steps

| Step | Students | Peak submits/s | Lost submissions (0) | Submit latency p99 (< 1 s) | Submit to grade on dashboard p95 (< 30 s) | Grades that fail (< 0.1%) | Verdict |
|---|---|---|---|---|---|---|---|
| 1 | 30 | 1.1 | ✅ 0 | ✅ 0.08 s | ✅ 8.23 s | ✅ 0.00% (0) | PASS |

### Step 1: 1 classes, 30 students

Run id `capacity-search-s1`, 12.2 minutes. PASS.

| Metric | Value |
|---|---|
| Students joined / planned | 30 / 30 |
| Submissions acknowledged / planned | 270 / 270 |
| Submit rate, mean / peak (10 s) | 0.4 / 1.1 per s |
| Submit, acknowledged incl. retries (p50 / p95 / p99 / max) | 0.01 s / 0.03 s / 0.08 s / 0.15 s (n=270) |
| Submit, single successful request | 0.01 s / 0.03 s / 0.07 s / 0.15 s (n=270) |
| Submit retries | 0 |
| Submit to grade on dashboard | 4.42 s / 8.23 s / 12.77 s / 15.16 s (n=270) |
| … waiting in queue | 0.35 s / 0.92 s / 1.00 s / 1.02 s (n=270) |
| … grading (model calls, retries, write) | 3.83 s / 7.49 s / 11.70 s / 15.05 s (n=270) |
| … outcome to dashboard (sync; crosses clocks) | 0.17 s / 0.38 s / 0.43 s / 0.46 s (n=270) |
| Grades needing more than one attempt | 0 |
| Peak queued / in flight | 4 / 7 |
| Grades: graded / needs teacher / couldn't grade | 234 / 36 / 0 |
| Failure reasons | none |
| Grades in a state the fixture does not predict | 0 |
| Lost submissions | 0 |
| Grades seen during the 1.5 s transition | 0.0% |
| Resumed by name on a new device (failed) | 1 (0) |
| Classes whose dashboard student count was wrong | 0 |
| Request errors | shape: HTTP 500: 22 |
| Class setup failures | none |
| Student join failures | none |
| Sync: shape requests (live), per s | 25057 (24927), 34.1 per s |
| Sync: requests by view | my-grades: 23162; my-session: 1018; grades: 774; students: 64; session: 39 |
| Sync: catch-up request latency | 0.01 s / 0.03 s / 0.09 s / 0.10 s (n=130) |
| Sync errors | 0 |
| Database: peak connections / max, active, waiting on locks, commits/s, deadlocks | 28 / 200, 2, 0, 22, 0 |
| Load generator: peak event-loop delay p99, CPU, open requests, heap | 60 ms, 16%, 64, 69 MB |
| Data deleted after the step | modelCalls: 270; classSessions: 1; assignments: 1; teachers: 1 |

