# Load test qstash-smoke-local

| | |
|---|---|
| Target | http://localhost:3290 |
| Started | 2026-10-15T16:31:22.047Z |
| Commit | `6381114` |
| Scenario | normal |
| Mock model | `seed` profile: guessed, not measured (log-normal latency, median 3.5 s, p95 9 s; about 1.2% errors) |
| Mock spec | `mode=sampled; profile=seed; start=<step start>` |
| Queue | QStash local dev server (port 8091), flow control parallelism 100 |
| Assignment | angle-relationships, 9 submissions per student |
| Time scale | 0.05 (each student's 20–40 min working window × 0.05; the 1-minute lobby and 2-minute bell spread run at real time; submission rate ≈ 20.0× a real testing day with the same head count) |
| Load generator | one Node v22.22.0 process on macbookpro.lan (8 CPUs, 16 GB) |

## Result

No step met every criterion.

Stopped because: step 1 failed submit-p99.

| Criterion | First failed at | Component that failed first |
|---|---|---|
| Submit latency p99 | step 1 (30 students) | Submit function: slow responses (upload, DB write or cold starts) |

The component is inferred from the step's metrics (errors, server timings, queue counts); it says where to look first, not a proven root cause.

## Steps

| Step | Students | Peak submits/s | Lost submissions (0) | Submit latency p99 (< 1 s) | Submit to grade on dashboard p95 (< 30 s) | Grades that fail (< 0.1%) | Verdict |
|---|---|---|---|---|---|---|---|
| 1 | 30 | 3.2 | ✅ 0 | ❌ 2.02 s | ✅ 9.77 s | ✅ 0.00% (0) | FAIL |

### Step 1: 1 classes, 30 students

Run id `qstash-smoke-local-s1`, 4.5 minutes. FAIL.

| Metric | Value |
|---|---|
| Students joined / planned | 30 / 30 |
| Submissions acknowledged / planned | 270 / 270 |
| Submit rate, mean / peak (10 s) | 1.0 / 3.2 per s |
| Submit, acknowledged incl. retries (p50 / p95 / p99 / max) | 0.03 s / 0.84 s / 2.02 s / 2.17 s (n=270) |
| Submit, single successful request | 0.03 s / 0.84 s / 2.02 s / 2.17 s (n=270) |
| Submit retries | 0 |
| Submit to grade on dashboard | 4.84 s / 9.77 s / 14.13 s / 18.32 s (n=270) |
| … waiting in queue | 0.20 s / 1.21 s / 1.64 s / 2.44 s (n=270) |
| … grading (model calls, retries, write) | 4.08 s / 9.13 s / 11.53 s / 14.97 s (n=270) |
| … outcome to dashboard (sync; crosses clocks) | 0.24 s / 1.19 s / 2.32 s / 9.10 s (n=270) |
| Grades needing more than one attempt | 0 |
| Peak queued / in flight | 8 / 19 |
| Grades: graded / needs teacher / couldn't grade | 234 / 36 / 0 |
| Failure reasons | none |
| Grades in a state the fixture does not predict | 0 |
| Lost submissions | 0 |
| Grades seen during the 1.5 s transition | 1.9% |
| Resumed by name on a new device (failed) | 1 (0) |
| Classes whose dashboard student count was wrong | 0 |
| Request errors | none |
| Class setup failures | none |
| Student join failures | none |
| Sync: shape requests (live), per s | 1898 (1768), 7.0 per s |
| Sync: requests by view | my-grades: 960; grades: 579; my-session: 303; students: 41; session: 15 |
| Sync: catch-up request latency | 0.01 s / 0.05 s / 0.09 s / 0.09 s (n=130) |
| Sync errors | 0 |
| Database: peak connections / max, active, waiting on locks, commits/s, deadlocks | 39 / 200, 5, 0, 60, 0 |
| Load generator: peak event-loop delay p99, CPU, open requests, heap | 83 ms, 11%, 69, 63 MB |
| Data deleted after the step | modelCalls: 270; classSessions: 2; assignments: 2; teachers: 1 |

