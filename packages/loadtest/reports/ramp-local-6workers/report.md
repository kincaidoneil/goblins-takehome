# Load test ramp-local-6workers

| | |
|---|---|
| Target | http://localhost:3290 |
| Started | 2026-10-15T16:53:35.702Z |
| Commit | `2fc2196` |
| Scenario | normal |
| Mock model | `seed` profile: guessed, not measured (log-normal latency, median 3.5 s, p95 9 s; about 1.2% errors) |
| Mock spec | `mode=sampled; profile=seed; start=<step start>` |
| Queue | QStash local dev server, flow control parallelism 100; the app as 6 Node worker processes on one port (a rough stand-in for Vercel instances), sharing an 8-core laptop with the generator, Postgres and Electric |
| Assignment | angle-relationships, 9 submissions per student |
| Time scale | 0.25 (each student's 20–40 min working window × 0.25; the 1-minute lobby and 2-minute bell spread run at real time; submission rate ≈ 4.0× a real testing day with the same head count) |
| Load generator | one Node v22.22.0 process on macbookpro.lan (8 CPUs, 16 GB) |

## Result

No step met every criterion.

Stopped because: step 1 failed submit-p99, dashboard-p95.

| Criterion | First failed at | Component that failed first |
|---|---|---|
| Submit latency p99 | step 1 (990 students) | Database: submit transactions waiting |
| Submit to grade on dashboard p95 | step 1 (990 students) | Sync (Electric): outcome to dashboard |

The component is inferred from the step's metrics (errors, server timings, queue counts); it says where to look first, not a proven root cause.

## Steps

| Step | Students | Peak submits/s | Lost submissions (0) | Submit latency p99 (< 1 s) | Submit to grade on dashboard p95 (< 30 s) | Grades that fail (< 0.1%) | Verdict |
|---|---|---|---|---|---|---|---|
| 1 | 990 | 21.9 | ✅ 0 | ❌ 5.77 s | ❌ 48.67 s | ✅ 0.00% (0) | FAIL |

### Step 1: 33 classes, 990 students

Run id `ramp-local-6workers-s1`, 13.9 minutes. FAIL.

| Metric | Value |
|---|---|
| Students joined / planned | 990 / 990 |
| Submissions acknowledged / planned | 8910 / 8910 |
| Submit rate, mean / peak (10 s) | 10.7 / 21.9 per s |
| Submit, acknowledged incl. retries (p50 / p95 / p99 / max) | 0.04 s / 1.35 s / 5.77 s / 8.40 s (n=8910) |
| Submit, single successful request | 0.04 s / 1.35 s / 5.77 s / 8.40 s (n=8910) |
| Submit retries | 0 |
| Submit to grade on dashboard | 9.39 s / 48.67 s / 67.47 s / 82.53 s (n=8910) |
| … waiting in queue | 0.14 s / 1.34 s / 3.50 s / 7.82 s (n=8910) |
| … grading (model calls, retries, write) | 3.71 s / 9.30 s / 13.58 s / 28.96 s (n=8910) |
| … outcome to dashboard (sync; crosses clocks) | 3.51 s / 43.77 s / 60.80 s / 67.30 s (n=8910) |
| Grades needing more than one attempt | 0 |
| Peak queued / in flight | 56 / 101 |
| Grades: graded / needs teacher / couldn't grade | 7981 / 929 / 0 |
| Failure reasons | none |
| Grades in a state the fixture does not predict | 0 |
| Lost submissions | 0 |
| Grades seen during the 1.5 s transition | 0.8% |
| Resumed by name on a new device (failed) | 53 (0) |
| Classes whose dashboard student count was wrong | 0 |
| Request errors | shape: HTTP 500: 414; stats: client timeout: 1 |
| Class setup failures | none |
| Student join failures | none |
| Sync: shape requests (live), per s | 112645 (108272), 135.2 per s |
| Sync: requests by view | my-grades: 51539; my-session: 31029; grades: 26936; students: 1974; session: 1167 |
| Sync: catch-up request latency | 0.01 s / 0.19 s / 0.82 s / 24.96 s (n=4370) |
| Sync errors | 0 |
| Database: peak connections / max, active, waiting on locks, commits/s, deadlocks | 42 / 200, 17, 4, 693, 0 |
| Load generator: peak event-loop delay p99, CPU, open requests, heap | 196 ms, 69%, 2178, 717 MB |
| Data deleted after the step | modelCalls: 9010; classSessions: 33; assignments: 33; teachers: 33 |

