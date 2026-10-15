# Load test short-rate-limit-storm

| | |
|---|---|
| Target | http://localhost:3290 |
| Started | 2026-10-15T18:39:22.704Z |
| Commit | `4216cf2` |
| Scenario | rate-limit-storm |
| Mock model | `claude-haiku-5.5` profile: measured from 1,839 real grading calls (p50 3.9 s, p95 8.0 s, p99 11.4 s; no failures in the sample, measured at 8 concurrent calls), plus a rate-limit storm (70% of calls get a 429 with Retry-After 2–10 s) in minutes 2–5 |
| Mock spec | `mode=sampled; profile=claude-haiku-5.5; scenario=rate-limit-storm; at=20; for=120; start=<step start>` |
| Queue | QStash local dev server, parallelism 100; the app as 6 Node processes on one port with per-student grade shapes (#124), Electric 1.8.1 with raised limits; SHORT SHAPE: no lobby, all 300 students start at once, working window x0.1 |
| Assignment | angle-relationships, 9 submissions per student |
| Time scale | 0.1 (each student's 20–40 min working window × 0.1; submission rate ≈ 10.0× a real testing day with the same head count); lobby 0 s, bell spread 0 s, both at real time |
| Load generator | one Node v22.22.0 process on macbookpro.lan (8 CPUs, 16 GB) |

## Result

No step met every criterion.

Stopped because: step 1 failed submit-p99, dashboard-p95.

| Criterion | First failed at | Component that failed first |
|---|---|---|
| Submit latency p99 | step 1 (300 students) | Submit function: slow responses (server CPU, whiteboard upload, queue publish or cold starts; no database evidence) |
| Submit to grade on dashboard p95 | step 1 (300 students) | Queue: grades waiting for a consumer slot (concurrency cap) |

The component is inferred from the step's metrics (errors, server timings, queue counts); it says where to look first, not a proven root cause.

## Steps

| Step | Students | Peak submits/s | Lost submissions (0) | Submit latency p99 (< 1 s) | Submit to grade on dashboard p95 (< 30 s) | Grades that fail (< 0.1%) | Verdict |
|---|---|---|---|---|---|---|---|
| 1 | 300 | 16.3 | ✅ 0 | ❌ 2.30 s | ❌ 81.68 s | ✅ 0.00% (0) | FAIL |

### Step 1: 10 classes, 300 students

Run id `short-rate-limit-storm-s1`, 4.3 minutes. FAIL.

| Metric | Value |
|---|---|
| Students joined / planned | 300 / 300 |
| Submissions acknowledged / planned | 2700 / 2700 |
| Submit rate, mean / peak (10 s) | 10.5 / 16.3 per s |
| Submit, acknowledged incl. retries (p50 / p95 / p99 / max) | 0.01 s / 0.33 s / 2.30 s / 3.47 s (n=2700) |
| Submit, single successful request | 0.01 s / 0.32 s / 2.29 s / 3.47 s (n=2700) |
| Submit retries | 0 |
| Submit to grade on dashboard | 10.08 s / 81.68 s / 146.01 s / 161.11 s (n=2700) |
| … waiting in queue | 5.37 s / 76.42 s / 140.98 s / 153.44 s (n=2700) |
| … grading (model calls, retries, write) | 3.93 s / 7.93 s / 10.68 s / 18.74 s (n=2700) |
| … outcome to dashboard (sync; crosses clocks) | 0.21 s / 2.20 s / 5.31 s / 6.24 s (n=2700) |
| Grades needing more than one attempt | 0 |
| Peak queued / in flight | 423 / 103 |
| Grades: graded / needs teacher / couldn't grade | 2408 / 292 / 0 |
| Failure reasons | none |
| Grades in a state the fixture does not predict | 0 |
| Lost submissions | 0 |
| Grades seen during the 1.5 s transition | 0.0% |
| Resumed by name on a new device (failed) | 18 (0) |
| Classes whose dashboard student count was wrong | 0 |
| Request errors | shape: HTTP 500: 18; join: network error: 8 |
| Class setup failures | none |
| Student join failures | none |
| Sync: shape requests (live), per s | 35170 (33837), 136.3 per s |
| Sync: requests by view | my-grades: 16486; grades: 14267; my-session: 4121; students: 156; session: 140 |
| Sync: catch-up request latency | 0.03 s / 4.78 s / 5.09 s / 5.17 s (n=1333) |
| Sync errors | 0 |
| Database: peak connections / max, active, waiting on locks, commits/s, deadlocks | 41 / 200, 14, 0, 789, 0 |
| Load generator: peak event-loop delay p99, CPU, open requests, heap | 112 ms, 58%, 679, 347 MB |
| Data deleted after the step | modelCalls: 6039; classSessions: 10; assignments: 10; teachers: 10 |

