# Load test local-app-3classes

| | |
|---|---|
| Target | http://localhost:3290 |
| Started | 2026-10-15T16:12:22.361Z |
| Commit | `74d724e` |
| Scenario | normal |
| Mock model | `seed` profile: guessed, not measured (log-normal latency, median 3.5 s, p95 9 s; 0.5% rate limits, 0.5% provider errors, 0.2% bad responses) |
| Mock spec | `mode=sampled; profile=seed; start=<step start>` |
| Queue | the app's inline in-process grade queue (local builds have no QStash; QStash runs only in a Vercel production deploy) |
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
| 1 | 90 | 9.6 | ✅ 0 | ❌ 1.38 s | ✅ 5.88 s | ✅ 0.00% (0) | FAIL |

### Step 1: 3 classes, 90 students

Run id `local-app-3classes-s1`, 2.2 minutes. FAIL.

| Metric | Value |
|---|---|
| Students joined / planned | 90 / 90 |
| Submissions acknowledged / planned | 810 / 810 |
| Submit rate, mean / peak (10 s) | 6.2 / 9.6 per s |
| Submit, acknowledged incl. retries (p50 / p95 / p99 / max) | 0.07 s / 0.98 s / 1.38 s / 2.25 s (n=810) |
| Submit, single successful request | 0.07 s / 0.98 s / 1.38 s / 2.25 s (n=810) |
| Submit retries | 0 |
| Submit to grade on dashboard | 2.31 s / 5.88 s / 8.00 s / 9.51 s (n=810) |
| … waiting in queue | 1.66 s / 2.46 s / 2.98 s / 4.51 s (n=810) |
| … grading (model calls, retries, write) | 0.04 s / 1.27 s / 1.81 s / 2.06 s (n=810) |
| … outcome to dashboard (sync; crosses clocks) | 0.32 s / 2.79 s / 5.08 s / 5.56 s (n=810) |
| Grades needing more than one attempt | 0 |
| Peak queued / in flight | 26 / 26 |
| Grades: graded / needs teacher / couldn't grade | 810 / 0 / 0 |
| Failure reasons | none |
| Grades in a state the fixture does not predict | 95 |
| Lost submissions | 0 |
| Grades seen during the 1.5 s transition | 17.2% |
| Resumed by name on a new device (failed) | 2 (0) |
| Classes whose dashboard student count was wrong | 0 |
| Request errors | shape: HTTP 500: 1 |
| Class setup failures | none |
| Student join failures | none |
| Sync: shape requests (live), per s | 5194 (4808), 39.6 per s |
| Sync: requests by view | my-grades: 2701; grades: 1654; my-session: 741; students: 73; session: 25 |
| Sync: catch-up request latency | 0.05 s / 1.04 s / 1.40 s / 1.53 s (n=386) |
| Sync errors | 0 |
| Database: peak connections / max, active, waiting on locks, commits/s, deadlocks | 32 / 200, 6, 0, 184, 0 |
| Load generator: peak event-loop delay p99, CPU, open requests, heap | 109 ms, 26%, 199, 181 MB |
| Data deleted after the step | classSessions: 3; assignments: 3; teachers: 3; modelCalls: 0 |

