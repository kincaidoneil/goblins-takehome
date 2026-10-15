# Load test smoke-production

| | |
|---|---|
| Target | https://goblins-takehome-gathers.vercel.app |
| Started | 2026-10-15T16:37:54.191Z |
| Commit | `3a7ad4a` |
| Scenario | normal |
| Mock model | `seed` profile: guessed, not measured (log-normal latency, median 3.5 s, p95 9 s; about 1.2% errors) |
| Mock spec | `mode=sampled; profile=seed; start=<step start>` |
| Queue | Vercel production: QStash (cloud, free plan, parallelism 10), Vercel Functions, Blob, self-hosted Electric |
| Assignment | angle-relationships, 9 submissions per student |
| Time scale | 0.1 (each student's 20–40 min working window × 0.1; the 1-minute lobby and 2-minute bell spread run at real time; submission rate ≈ 10.0× a real testing day with the same head count) |
| Load generator | one Node v22.22.0 process on macbookpro.lan (8 CPUs, 16 GB) |

## Result

Every criterion held up to **30 students**.

Stopped because: every planned step ran.

## Steps

| Step | Students | Peak submits/s | Lost submissions (0) | Submit latency p99 (< 1 s) | Submit to grade on dashboard p95 (< 30 s) | Grades that fail (< 0.1%) | Verdict |
|---|---|---|---|---|---|---|---|
| 1 | 30 | 1.9 | ✅ 0 | ✅ 0.66 s | ✅ 9.21 s | ✅ 0.00% (0) | PASS |

### Step 1: 1 classes, 30 students

Run id `smoke-production-s1`, 6.3 minutes. PASS.

| Metric | Value |
|---|---|
| Students joined / planned | 30 / 30 |
| Submissions acknowledged / planned | 270 / 270 |
| Submit rate, mean / peak (10 s) | 0.7 / 1.9 per s |
| Submit, acknowledged incl. retries (p50 / p95 / p99 / max) | 0.14 s / 0.34 s / 0.66 s / 0.71 s (n=270) |
| Submit, single successful request | 0.14 s / 0.34 s / 0.66 s / 0.70 s (n=270) |
| Submit retries | 0 |
| Submit to grade on dashboard | 4.26 s / 9.21 s / 11.18 s / 17.20 s (n=270) |
| … waiting in queue | 0.22 s / 0.79 s / 1.30 s / 4.75 s (n=270) |
| … grading (model calls, retries, write) | 3.61 s / 8.68 s / 10.65 s / 16.83 s (n=270) |
| … outcome to dashboard (sync; crosses clocks) | 0.05 s / 0.23 s / 0.52 s / 0.88 s (n=270) |
| Grades needing more than one attempt | 0 |
| Peak queued / in flight | 5 / 10 |
| Grades: graded / needs teacher / couldn't grade | 234 / 36 / 0 |
| Failure reasons | none |
| Grades in a state the fixture does not predict | 0 |
| Lost submissions | 0 |
| Grades seen during the 1.5 s transition | 4.1% |
| Resumed by name on a new device (failed) | 1 (0) |
| Classes whose dashboard student count was wrong | 0 |
| Request errors | none |
| Class setup failures | none |
| Student join failures | none |
| Sync: shape requests (live), per s | 2339 (2209), 6.2 per s |
| Sync: requests by view | my-grades: 1067; grades: 726; my-session: 479; students: 46; session: 21 |
| Sync: catch-up request latency | 0.11 s / 0.35 s / 0.41 s / 0.44 s (n=130) |
| Sync errors | 0 |
| Database: peak connections / max, active, waiting on locks, commits/s, deadlocks | 25 / 112, 2, 0, 42, 0 |
| Load generator: peak event-loop delay p99, CPU, open requests, heap | 295 ms, 12%, 65, 63 MB |
| Data deleted after the step | modelCalls: 274; classSessions: 1; assignments: 1; teachers: 1 |

