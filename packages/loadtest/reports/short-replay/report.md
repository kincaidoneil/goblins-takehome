# Load test short-replay

| | |
|---|---|
| Target | http://localhost:3290 |
| Started | 2026-10-15T18:50:26.750Z |
| Commit | `4216cf2 (head of PR #129, app as built from PR #124; on main as afbf6fc and 2523979)` |
| Scenario | replay |
| Mock model | replay of the `claude-haiku-5.5` recording |
| Mock spec | `mode=replay; recording=claude-haiku-5.5; start=<step start>` |
| Queue | QStash local dev server, parallelism 100; the app as 6 Node processes on one port with per-student grade shapes (#124), Electric 1.8.1 with raised limits; SHORT SHAPE: no lobby, all 300 students start at once, working window x0.1 |
| Assignment | angle-relationships, 9 submissions per student |
| Time scale | 0.1 (each student's 20–40 min working window × 0.1; submission rate ≈ 10.0× a real testing day with the same head count); lobby 0 s, bell spread 0 s, both at real time |
| Load generator | one Node v22.22.0 process on macbookpro.lan (8 CPUs, 16 GB) |

## Result

No step met every criterion.

Stopped because: step 1 failed submit-p99.

| Criterion | First failed at | Component that failed first |
|---|---|---|
| Submit latency p99 | step 1 (300 students) | Submit function: slow responses (server CPU, whiteboard upload, queue publish or cold starts; no database evidence) |

The component is inferred from the step's metrics (errors, server timings, queue counts); it says where to look first, not a proven root cause.

## Steps

| Step | Students | Peak submits/s | Lost submissions (0) | Submit latency p99 (< 1 s) | Submit to grade on dashboard p95 (< 30 s) | Grades that fail (< 0.1%) | Verdict |
|---|---|---|---|---|---|---|---|
| 1 | 300 | 16.6 | ✅ 0 | ❌ 1.50 s | ✅ 8.72 s | ✅ 0.00% (0) | FAIL |

### Step 1: 10 classes, 300 students

Run id `short-replay-s1`, 4.4 minutes. FAIL.

| Metric | Value |
|---|---|
| Students joined / planned | 300 / 300 |
| Submissions acknowledged / planned | 2700 / 2700 |
| Submit rate, mean / peak (10 s) | 10.3 / 16.6 per s |
| Submit, acknowledged incl. retries (p50 / p95 / p99 / max) | 0.01 s / 0.36 s / 1.50 s / 2.23 s (n=2700) |
| Submit, single successful request | 0.01 s / 0.36 s / 1.50 s / 2.22 s (n=2700) |
| Submit retries | 0 |
| Submit to grade on dashboard | 4.35 s / 8.72 s / 11.82 s / 33.82 s (n=2700) |
| … waiting in queue | 0.09 s / 0.71 s / 1.62 s / 2.35 s (n=2700) |
| … grading (model calls, retries, write) | 3.81 s / 8.19 s / 10.67 s / 33.30 s (n=2700) |
| … outcome to dashboard (sync; crosses clocks) | 0.20 s / 1.47 s / 2.90 s / 3.96 s (n=2700) |
| Grades needing more than one attempt | 0 |
| Peak queued / in flight | 47 / 100 |
| Grades: graded / needs teacher / couldn't grade | 2408 / 292 / 0 |
| Failure reasons | none |
| Grades in a state the fixture does not predict | 0 |
| Lost submissions | 0 |
| Grades seen during the 1.5 s transition | 0.0% |
| Resumed by name on a new device (failed) | 18 (0) |
| Classes whose dashboard student count was wrong | 0 |
| Request errors | shape: network error: 46; shape: HTTP 500: 3 |
| Class setup failures | none |
| Student join failures | none |
| Sync: shape requests (live), per s | 22762 (21384), 86.9 per s |
| Sync: requests by view | my-grades: 10296; grades: 7903; my-session: 4264; students: 159; session: 140 |
| Sync: catch-up request latency | 0.02 s / 2.55 s / 2.75 s / 2.80 s (n=1333) |
| Sync errors | 0 |
| Database: peak connections / max, active, waiting on locks, commits/s, deadlocks | 41 / 200, 10, 0, 417, 0 |
| Load generator: peak event-loop delay p99, CPU, open requests, heap | 146 ms, 60%, 659, 219 MB |
| Data deleted after the step | modelCalls: 2700; classSessions: 10; assignments: 10; teachers: 10 |

