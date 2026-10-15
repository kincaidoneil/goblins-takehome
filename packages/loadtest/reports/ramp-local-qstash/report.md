# Load test ramp-local-qstash

| | |
|---|---|
| Target | http://localhost:3290 |
| Started | 2026-10-15T16:37:21.823Z |
| Commit | `3a7ad4a` |
| Scenario | normal |
| Mock model | `seed` profile: guessed, not measured (log-normal latency, median 3.5 s, p95 9 s; about 1.2% errors) |
| Mock spec | `mode=sampled; profile=seed; start=<step start>` |
| Queue | QStash local dev server, flow control parallelism 100; the app is ONE local Node process (Vercel runs many instances) |
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
| 1 | 990 | 57.0 | ✅ 0 | ❌ 49.49 s | ❌ 254.22 s | ✅ 0.00% (0) | FAIL |

### Step 1: 33 classes, 990 students

Run id `ramp-local-qstash-s1`, 14.5 minutes. FAIL.

| Metric | Value |
|---|---|
| Students joined / planned | 990 / 990 |
| Submissions acknowledged / planned | 8910 / 8910 |
| Submit rate, mean / peak (10 s) | 10.3 / 57.0 per s |
| Submit, acknowledged incl. retries (p50 / p95 / p99 / max) | 0.97 s / 15.56 s / 49.49 s / 75.74 s (n=8910) |
| Submit, single successful request | 0.97 s / 15.29 s / 25.03 s / 29.98 s (n=8910) |
| Submit retries | 210 |
| Submit to grade on dashboard | 172.31 s / 254.22 s / 319.10 s / 352.78 s (n=8910) |
| … waiting in queue | 39.71 s / 85.89 s / 152.96 s / 187.40 s (n=8910) |
| … grading (model calls, retries, write) | 4.34 s / 11.90 s / 17.39 s / 34.89 s (n=8910) |
| … outcome to dashboard (sync; crosses clocks) | 114.41 s / 172.03 s / 179.17 s / 180.70 s (n=8910) |
| Grades needing more than one attempt | 0 |
| Peak queued / in flight | 1497 / 108 |
| Grades: graded / needs teacher / couldn't grade | 7970 / 940 / 0 |
| Failure reasons | none |
| Grades in a state the fixture does not predict | 0 |
| Lost submissions | 0 |
| Grades seen during the 1.5 s transition | 0.0% |
| Resumed by name on a new device (failed) | 53 (0) |
| Classes whose dashboard student count was wrong | 0 |
| Request errors | shape: network error: 797; join: client timeout: 679; shape: HTTP 503: 620; submit: client timeout: 156; shape: HTTP 500: 137; submit: network error: 54; start-session: client timeout: 28; stats: client timeout: 11; join: network error: 2; shape: HTTP 409: 1 |
| Class setup failures | none |
| Student join failures | none |
| Sync: shape requests (live), per s | 110062 (105042), 126.7 per s |
| Sync: requests by view | my-grades: 50512; my-session: 31027; grades: 25679; students: 1791; session: 1053 |
| Sync: catch-up request latency | 0.06 s / 13.73 s / 23.05 s / 80.78 s (n=4371) |
| Sync errors | 0 |
| Database: peak connections / max, active, waiting on locks, commits/s, deadlocks | 42 / 200, 15, 3, 639, 0 |
| Load generator: peak event-loop delay p99, CPU, open requests, heap | 949 ms, 80%, 2453, 733 MB |
| Data deleted after the step | modelCalls: 9037; classSessions: 33; assignments: 33; teachers: 33 |

