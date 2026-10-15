# Load test per-student-990

| | |
|---|---|
| Target | http://localhost:3290 |
| Started | 2026-10-15T18:24:51.567Z |
| Commit | `5f7df03 (head of PR #124; on main as 2523979)` |
| Scenario | normal |
| Mock model | `claude-haiku-5.5` profile: measured from 1,839 real grading calls (p50 3.9 s, p95 8.0 s, p99 11.4 s; no failures in the sample, measured at 8 concurrent calls) |
| Mock spec | `mode=sampled; profile=claude-haiku-5.5; start=<step start>` |
| Queue | QStash local dev server, flow control parallelism 100; the app as 6 Node processes on one port with per-student grade shapes (#124), sharing an 8-core laptop with the generator, Postgres and Electric 1.8.1 (raised limits, fresh start) |
| Assignment | angle-relationships, 9 submissions per student |
| Time scale | 0.25 (each student's 20–40 min working window × 0.25; the 1-minute lobby and 2-minute bell spread run at real time; submission rate ≈ 4.0× a real testing day with the same head count) |
| Load generator | one Node v22.22.0 process on macbookpro.lan (8 CPUs, 16 GB) |

## Result

No step met every criterion.

Stopped because: step 1 hit the load generator's own limit; shard the load across machines to go higher.

| Criterion | First failed at | Component that failed first |
|---|---|---|
| Submit latency p99 | step 1 (990 students) | Database: submit transactions waiting on locks or connections |
| Submit to grade on dashboard p95 | step 1 (990 students) | Sync (Electric): outcome to dashboard |

The component is inferred from the step's metrics (errors, server timings, queue counts); it says where to look first, not a proven root cause.

## Steps

| Step | Students | Peak submits/s | Lost submissions (0) | Submit latency p99 (< 1 s) | Submit to grade on dashboard p95 (< 30 s) | Grades that fail (< 0.1%) | Verdict |
|---|---|---|---|---|---|---|---|
| 1 | 990 | 81.6 | ✅ 0 | ❌ 86.48 s | ❌ 189.46 s | ✅ 0.00% (0) | INVALID (load generator limited) |

### Step 1: 33 classes, 990 students

Run id `per-student-990-s1`, 14.0 minutes. INVALID (load generator limited).

| Metric | Value |
|---|---|
| Students joined / planned | 990 / 990 |
| Submissions acknowledged / planned | 8910 / 8910 |
| Submit rate, mean / peak (10 s) | 10.6 / 81.6 per s |
| Submit, acknowledged incl. retries (p50 / p95 / p99 / max) | 0.15 s / 51.72 s / 86.48 s / 121.74 s (n=8910) |
| Submit, single successful request | 0.15 s / 21.34 s / 24.74 s / 29.89 s (n=8910) |
| Submit retries | 1622 |
| Submit to grade on dashboard | 92.98 s / 189.46 s / 224.56 s / 263.93 s (n=8910) |
| … waiting in queue | 33.11 s / 112.66 s / 117.08 s / 117.63 s (n=8910) |
| … grading (model calls, retries, write) | 4.26 s / 9.51 s / 15.62 s / 34.07 s (n=8910) |
| … outcome to dashboard (sync; crosses clocks) | 8.39 s / 117.13 s / 124.60 s / 129.08 s (n=8910) |
| Grades needing more than one attempt | 0 |
| Peak queued / in flight | 2007 / 102 |
| Grades: graded / needs teacher / couldn't grade | 7981 / 929 / 0 |
| Failure reasons | none |
| Grades in a state the fixture does not predict | 0 |
| Lost submissions | 0 |
| Grades seen during the 1.5 s transition | 0.0% |
| Resumed by name on a new device (failed) | 53 (0) |
| Classes whose dashboard student count was wrong | 0 |
| Request errors | shape: network error: 2098; submit: client timeout: 1026; shape: HTTP 500: 804; submit: network error: 596; shape: HTTP 503: 123; stats: client timeout: 6; join: client timeout: 5; stats: network error: 1 |
| Class setup failures | none |
| Student join failures | none |
| Sync: shape requests (live), per s | 105644 (96966), 125.8 per s |
| Sync: requests by view | my-grades: 47990; my-session: 29160; grades: 25667; students: 1826; session: 1001 |
| Sync: catch-up request latency | 0.01 s / 31.96 s / 39.05 s / 44.30 s (n=6448) |
| Sync errors | 0 |
| Database: peak connections / max, active, waiting on locks, commits/s, deadlocks | 42 / 200, 17, 9, 686, 0 |
| Load generator: peak event-loop delay p99, CPU, open requests, heap | 1475 ms, 79%, 3059, 738 MB |
| Data deleted after the step | modelCalls: 8910; classSessions: 33; assignments: 33; teachers: 33 |

