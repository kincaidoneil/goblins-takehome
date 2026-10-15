# Load test short-latency-doubling

| | |
|---|---|
| Target | http://localhost:3290 |
| Started | 2026-10-15T18:44:24.720Z |
| Commit | `4216cf2` |
| Scenario | latency-doubling |
| Mock model | `claude-haiku-5.5` profile: measured from 1,839 real grading calls (p50 3.9 s, p95 8.0 s, p99 11.4 s; no failures in the sample, measured at 8 concurrent calls), with every latency doubled |
| Mock spec | `mode=sampled; profile=claude-haiku-5.5; scenario=latency-doubling; start=<step start>` |
| Queue | QStash local dev server, parallelism 100; the app as 6 Node processes on one port with per-student grade shapes (#124), Electric 1.8.1 with raised limits; SHORT SHAPE: no lobby, all 300 students start at once, working window x0.1 |
| Assignment | angle-relationships, 9 submissions per student |
| Time scale | 0.1 (each student's 20–40 min working window × 0.1; submission rate ≈ 10.0× a real testing day with the same head count); lobby 0 s, bell spread 0 s, both at real time |
| Load generator | one Node v22.22.0 process on macbookpro.lan (8 CPUs, 16 GB) |

## Result

No step met every criterion.

Stopped because: step 1 failed dashboard-p95.

| Criterion | First failed at | Component that failed first |
|---|---|---|
| Submit to grade on dashboard p95 | step 1 (300 students) | Queue: grades waiting for a consumer slot (concurrency cap) |

The component is inferred from the step's metrics (errors, server timings, queue counts); it says where to look first, not a proven root cause.

## Steps

| Step | Students | Peak submits/s | Lost submissions (0) | Submit latency p99 (< 1 s) | Submit to grade on dashboard p95 (< 30 s) | Grades that fail (< 0.1%) | Verdict |
|---|---|---|---|---|---|---|---|
| 1 | 300 | 16.3 | ✅ 0 | ✅ 0.14 s | ❌ 56.93 s | ✅ 0.00% (0) | FAIL |

### Step 1: 10 classes, 300 students

Run id `short-latency-doubling-s1`, 5.4 minutes. FAIL.

| Metric | Value |
|---|---|
| Students joined / planned | 300 / 300 |
| Submissions acknowledged / planned | 2700 / 2700 |
| Submit rate, mean / peak (10 s) | 8.4 / 16.3 per s |
| Submit, acknowledged incl. retries (p50 / p95 / p99 / max) | 0.01 s / 0.04 s / 0.14 s / 0.47 s (n=2700) |
| Submit, single successful request | 0.01 s / 0.04 s / 0.14 s / 0.47 s (n=2700) |
| Submit retries | 0 |
| Submit to grade on dashboard | 38.08 s / 56.93 s / 62.78 s / 139.55 s (n=2700) |
| … waiting in queue | 29.15 s / 45.55 s / 46.11 s / 132.57 s (n=2700) |
| … grading (model calls, retries, write) | 7.86 s / 16.26 s / 28.53 s / 51.21 s (n=2700) |
| … outcome to dashboard (sync; crosses clocks) | 0.19 s / 0.35 s / 0.59 s / 2.05 s (n=2700) |
| Grades needing more than one attempt | 0 |
| Peak queued / in flight | 516 / 103 |
| Grades: graded / needs teacher / couldn't grade | 2408 / 292 / 0 |
| Failure reasons | none |
| Grades in a state the fixture does not predict | 0 |
| Lost submissions | 0 |
| Grades seen during the 1.5 s transition | 0.0% |
| Resumed by name on a new device (failed) | 18 (0) |
| Classes whose dashboard student count was wrong | 0 |
| Request errors | shape: network error: 49; join: network error: 20; shape: HTTP 500: 8; start-session: network error: 1 |
| Class setup failures | none |
| Student join failures | none |
| Sync: shape requests (live), per s | 22843 (21465), 71.0 per s |
| Sync: requests by view | my-grades: 9767; grades: 8034; my-session: 4696; students: 187; session: 159 |
| Sync: catch-up request latency | 0.02 s / 1.72 s / 1.85 s / 1.93 s (n=1333) |
| Sync errors | 0 |
| Database: peak connections / max, active, waiting on locks, commits/s, deadlocks | 39 / 200, 6, 0, 286, 0 |
| Load generator: peak event-loop delay p99, CPU, open requests, heap | 109 ms, 69%, 632, 131 MB |
| Data deleted after the step | modelCalls: 2705; classSessions: 10; assignments: 10; teachers: 10 |

