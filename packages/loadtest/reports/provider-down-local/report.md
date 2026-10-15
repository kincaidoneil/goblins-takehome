# Load test provider-down-local

| | |
|---|---|
| Target | http://localhost:3290 |
| Started | 2026-10-15T17:08:13.424Z |
| Commit | `d20067b` |
| Scenario | provider-down |
| Mock model | `seed` profile: guessed, not measured (log-normal latency, median 3.5 s, p95 9 s; about 1.2% errors), plus the provider down for 5 minutes (every call fails with no response) |
| Mock spec | `mode=sampled; profile=seed; scenario=provider-down; at=90; for=300; start=<step start>` |
| Queue | QStash local dev server, flow control parallelism 100; the app as 6 Node worker processes on one port |
| Assignment | angle-relationships, 9 submissions per student |
| Time scale | 0.5 (each student's 20–40 min working window × 0.5; the 1-minute lobby and 2-minute bell spread run at real time; submission rate ≈ 2.0× a real testing day with the same head count) |
| Load generator | one Node v22.22.0 process on macbookpro.lan (8 CPUs, 16 GB) |

## Result

No step met every criterion.

Stopped because: step 1 failed dashboard-p95.

| Criterion | First failed at | Component that failed first |
|---|---|---|
| Submit to grade on dashboard p95 | step 1 (300 students) | Queue: grades waiting for a consumer slot (concurrency cap) |

The component is inferred from the step's metrics (errors, server timings, queue counts); it says where to look first, not a proven root cause.

## Steps

| Step | Students | Peak submits/s | Lost submissions (0) | Submit latency p99 (< 1 s) | Submit to grade on dashboard p95 (< 30 s) | Grades that fail, provider down 5 min (0%) | Verdict |
|---|---|---|---|---|---|---|---|
| 1 | 300 | 4.5 | ✅ 0 | ✅ 0.62 s | ❌ 192.36 s | ✅ 0.00% (0) | FAIL |

### Step 1: 10 classes, 300 students

Run id `provider-down-local-s1`, 23.8 minutes. FAIL.

| Metric | Value |
|---|---|
| Students joined / planned | 300 / 300 |
| Submissions acknowledged / planned | 2700 / 2700 |
| Submit rate, mean / peak (10 s) | 1.9 / 4.5 per s |
| Submit, acknowledged incl. retries (p50 / p95 / p99 / max) | 0.01 s / 0.14 s / 0.62 s / 3.38 s (n=2700) |
| Submit, single successful request | 0.01 s / 0.14 s / 0.62 s / 3.38 s (n=2700) |
| Submit retries | 0 |
| Submit to grade on dashboard | 4.78 s / 192.36 s / 238.55 s / 312.34 s (n=2700) |
| … waiting in queue | 0.22 s / 188.36 s / 234.55 s / 310.52 s (n=2700) |
| … grading (model calls, retries, write) | 3.50 s / 9.29 s / 13.20 s / 22.89 s (n=2700) |
| … outcome to dashboard (sync; crosses clocks) | 0.20 s / 0.39 s / 0.52 s / 0.94 s (n=2700) |
| Grades needing more than one attempt | 0 |
| Peak queued / in flight | 585 / 88 |
| Grades: graded / needs teacher / couldn't grade | 2408 / 292 / 0 |
| Failure reasons | none |
| Grades in a state the fixture does not predict | 0 |
| Lost submissions | 0 |
| Grades seen during the 1.5 s transition | 2.0% |
| Resumed by name on a new device (failed) | 18 (0) |
| Classes whose dashboard student count was wrong | 0 |
| Request errors | shape: HTTP 500: 50 |
| Class setup failures | none |
| Student join failures | none |
| Sync: shape requests (live), per s | 66002 (64668), 46.2 per s |
| Sync: requests by view | my-grades: 30618; my-session: 19093; grades: 14655; students: 941; session: 695 |
| Sync: catch-up request latency | 0.02 s / 0.49 s / 2.44 s / 5.73 s (n=1334) |
| Sync errors | 0 |
| Database: peak connections / max, active, waiting on locks, commits/s, deadlocks | 41 / 200, 8, 0, 354, 0 |
| Load generator: peak event-loop delay p99, CPU, open requests, heap | 263 ms, 22%, 635, 149 MB |
| Data deleted after the step | modelCalls: 6109; classSessions: 10; assignments: 10; teachers: 10 |

