# Load test dryrun-standin-3classes

| | |
|---|---|
| Target | http://localhost:3190 |
| Started | 2026-10-15T16:03:24.012Z |
| Commit | `42ea5c7` |
| Scenario | normal |
| Mock model | `seed` profile: guessed, not measured (log-normal latency, median 3.5 s, p95 9 s; 0.5% rate limits, 0.5% provider errors, 0.2% bad responses) |
| Mock spec | `mode=sampled; profile=seed; start=<step start>` |
| Queue | STAND-IN, not the app: packages/loadtest stand-in server, in-memory queue (not QStash), grading concurrency 100, local Postgres and Electric in Docker |
| Assignment | angle-relationships, 9 submissions per student |
| Time scale | 0.05 (every interval × 0.05; submission rate ≈ 20.0× a real testing day with the same head count) |
| Load generator | one Node v22.22.0 process on macbookpro.lan (8 CPUs, 16 GB) |

## Result

No step met every criterion.

Stopped because: step 1 failed submit-p99.

| Criterion | First failed at | Component that failed first |
|---|---|---|
| Submit latency p99 | step 1 (90 students) | Submit function: slow responses (upload, DB write or cold starts) |

The component is inferred from the step's metrics (errors, server timings, queue counts); it says where to look first, not a proven root cause.

## Steps

| Step | Students | Peak submits/s | Lost submissions (0) | Submit latency p99 (< 1 s) | Submit to grade on dashboard p95 (< 30 s) | Grades that fail (< 0.1%) | Verdict |
|---|---|---|---|---|---|---|---|
| 1 | 90 | 13.2 | ✅ 0 | ❌ 8.28 s | ✅ 26.42 s | ✅ 0.00% (0) | FAIL |

### Step 1: 3 classes, 90 students

Run id `dryrun-standin-3classes-s1`, 2.2 minutes. FAIL.

| Metric | Value |
|---|---|
| Students joined / planned | 90 / 90 |
| Submissions acknowledged / planned | 810 / 810 |
| Submit rate, mean / peak (10 s) | 6.1 / 13.2 per s |
| Submit, acknowledged incl. retries (p50 / p95 / p99 / max) | 0.03 s / 4.96 s / 8.28 s / 9.44 s (n=810) |
| Submit, single successful request | 0.03 s / 4.96 s / 8.28 s / 9.44 s (n=810) |
| Submit retries | 0 |
| Submit to grade on dashboard | 5.63 s / 26.42 s / 30.42 s / 31.85 s (n=810) |
| … waiting in queue | 0.02 s / 4.18 s / 6.89 s / 10.70 s (n=810) |
| … grading (model calls, retries, write) | 3.97 s / 11.52 s / 14.72 s / 16.90 s (n=810) |
| … outcome to dashboard (sync; crosses clocks) | 0.36 s / 13.58 s / 18.21 s / 25.18 s (n=810) |
| Grades needing more than one attempt | 0 |
| Peak queued / in flight | 49 / 101 |
| Grades: graded / needs teacher / couldn't grade | 715 / 95 / 0 |
| Failure reasons | none |
| Grades in a state the fixture does not predict | 0 |
| Lost submissions | 0 |
| Grades seen during the 1.5 s transition | 2.0% |
| Resumed by name on a new device (failed) | 2 (0) |
| Classes whose dashboard student count was wrong | 0 |
| Request errors | shape: HTTP 502: 1 |
| Class setup failures | none |
| Student join failures | none |
| Sync: shape requests (live), per s | 5332 (4946), 40.3 per s |
| Sync: requests by view | my-grades: 2730; grades: 1750; my-session: 751; students: 77; session: 24 |
| Sync: catch-up request latency | 0.05 s / 1.08 s / 1.40 s / 1.54 s (n=386) |
| Sync errors | 0 |
| Database: peak connections / max, active, waiting on locks, commits/s, deadlocks | 61 / 200, 35, 0, 225, 0 |
| Load generator: peak event-loop delay p99, CPU, open requests, heap | 193 ms, 30%, 248, 95 MB |
| Data deleted after the step | classSessions: 3; assignments: 3; teachers: 3; modelCalls: 0 |

