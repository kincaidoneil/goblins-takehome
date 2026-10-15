# Load test after-sync-fix-510

| | |
|---|---|
| Target | http://localhost:3290 |
| Started | 2026-10-15T18:02:34.700Z |
| Commit | `cd7b05a` |
| Scenario | normal |
| Mock model | `claude-haiku-5.5` profile: measured from 1,839 real grading calls (p50 3.9 s, p95 8.0 s, p99 11.4 s; no failures in the sample, measured at 8 concurrent calls) |
| Mock spec | `mode=sampled; profile=claude-haiku-5.5; start=<step start>` |
| Queue | QStash local dev server, flow control parallelism 100; the app as 6 Node processes on one port with per-class shapes (#104), sharing an 8-core laptop with the generator, Postgres and Electric 1.8.1 |
| Assignment | angle-relationships, 9 submissions per student |
| Time scale | 0.25 (each student's 20–40 min working window × 0.25; the 1-minute lobby and 2-minute bell spread run at real time; submission rate ≈ 4.0× a real testing day with the same head count) |
| Load generator | one Node v22.22.0 process on macbookpro.lan (8 CPUs, 16 GB) |

## Result

Every criterion held up to **510 students**.

Stopped because: every planned step ran.

## Steps

| Step | Students | Peak submits/s | Lost submissions (0) | Submit latency p99 (< 1 s) | Submit to grade on dashboard p95 (< 30 s) | Grades that fail (< 0.1%) | Verdict |
|---|---|---|---|---|---|---|---|
| 1 | 510 | 12.8 | ✅ 0 | ✅ 0.38 s | ✅ 18.38 s | ✅ 0.00% (0) | PASS |

### Step 1: 17 classes, 510 students

Run id `after-sync-fix-510-s1`, 13.3 minutes. PASS.

| Metric | Value |
|---|---|
| Students joined / planned | 510 / 510 |
| Submissions acknowledged / planned | 4590 / 4590 |
| Submit rate, mean / peak (10 s) | 5.7 / 12.8 per s |
| Submit, acknowledged incl. retries (p50 / p95 / p99 / max) | 0.02 s / 0.15 s / 0.38 s / 1.50 s (n=4590) |
| Submit, single successful request | 0.02 s / 0.15 s / 0.38 s / 1.50 s (n=4590) |
| Submit retries | 0 |
| Submit to grade on dashboard | 5.22 s / 18.38 s / 27.87 s / 44.15 s (n=4590) |
| … waiting in queue | 0.12 s / 0.39 s / 0.65 s / 1.28 s (n=4590) |
| … grading (model calls, retries, write) | 3.97 s / 8.11 s / 10.79 s / 33.34 s (n=4590) |
| … outcome to dashboard (sync; crosses clocks) | 0.35 s / 12.52 s / 23.14 s / 25.82 s (n=4590) |
| Grades needing more than one attempt | 0 |
| Peak queued / in flight | 13 / 69 |
| Grades: graded / needs teacher / couldn't grade | 4108 / 482 / 0 |
| Failure reasons | none |
| Grades in a state the fixture does not predict | 0 |
| Lost submissions | 0 |
| Grades seen during the 1.5 s transition | 0.0% |
| Resumed by name on a new device (failed) | 28 (0) |
| Classes whose dashboard student count was wrong | 0 |
| Request errors | shape: HTTP 500: 1696 |
| Class setup failures | none |
| Student join failures | none |
| Sync: shape requests (live), per s | 435168 (432914), 543.7 per s |
| Sync: requests by view | my-grades: 402930; my-session: 17057; grades: 13441; students: 1080; session: 660 |
| Sync: catch-up request latency | 0.01 s / 0.08 s / 0.35 s / 1.11 s (n=2254) |
| Sync errors | 0 |
| Database: peak connections / max, active, waiting on locks, commits/s, deadlocks | 41 / 200, 5, 0, 235, 0 |
| Load generator: peak event-loop delay p99, CPU, open requests, heap | 177 ms, 93%, 1075, 867 MB |
| Data deleted after the step | modelCalls: 4590; classSessions: 17; assignments: 17; teachers: 17 |

