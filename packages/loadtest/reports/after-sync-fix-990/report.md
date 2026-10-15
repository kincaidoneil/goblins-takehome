# Load test after-sync-fix-990

| | |
|---|---|
| Target | http://localhost:3290 |
| Started | 2026-10-15T17:46:47.448Z |
| Commit | `cd7b05a` |
| Scenario | normal |
| Mock model | `claude-haiku-5.5` profile: measured from 1,839 real grading calls (p50 3.9 s, p95 8.0 s, p99 11.4 s; no failures in the sample, measured at 8 concurrent calls) |
| Mock spec | `mode=sampled; profile=claude-haiku-5.5; start=<step start>` |
| Queue | QStash local dev server, flow control parallelism 100; the app as 6 Node processes on one port (scripts/cluster.mjs) with per-class shapes (#104), sharing an 8-core laptop with the generator, Postgres and Electric 1.8.1 (raised concurrency limits) |
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
| 1 | 990 | 23.4 | ✅ 0 | ❌ 2.73 s | ❌ 256.05 s | ✅ 0.00% (0) | INVALID (load generator limited) |

### Step 1: 33 classes, 990 students

Run id `after-sync-fix-990-s1`, 15.2 minutes. INVALID (load generator limited).

| Metric | Value |
|---|---|
| Students joined / planned | 990 / 990 |
| Submissions acknowledged / planned | 8910 / 8910 |
| Submit rate, mean / peak (10 s) | 9.8 / 23.4 per s |
| Submit, acknowledged incl. retries (p50 / p95 / p99 / max) | 0.27 s / 1.80 s / 2.73 s / 3.52 s (n=8910) |
| Submit, single successful request | 0.27 s / 1.80 s / 2.73 s / 3.52 s (n=8910) |
| Submit retries | 0 |
| Submit to grade on dashboard | 165.53 s / 256.05 s / 259.93 s / 421.14 s (n=8910) |
| … waiting in queue | 6.84 s / 14.07 s / 34.63 s / 191.86 s (n=8910) |
| … grading (model calls, retries, write) | 4.22 s / 8.33 s / 11.65 s / 33.72 s (n=8910) |
| … outcome to dashboard (sync; crosses clocks) | 149.19 s / 251.06 s / 253.26 s / 255.83 s (n=8910) |
| Grades needing more than one attempt | 0 |
| Peak queued / in flight | 317 / 105 |
| Grades: graded / needs teacher / couldn't grade | 7981 / 929 / 0 |
| Failure reasons | none |
| Grades in a state the fixture does not predict | 0 |
| Lost submissions | 0 |
| Grades seen during the 1.5 s transition | 0.0% |
| Resumed by name on a new device (failed) | 53 (0) |
| Classes whose dashboard student count was wrong | 0 |
| Request errors | shape: network error: 2671; shape: HTTP 500: 1449 |
| Class setup failures | none |
| Student join failures | none |
| Sync: shape requests (live), per s | 773729 (769357), 849.8 per s |
| Sync: requests by view | my-grades: 706155; my-session: 41499; grades: 22222; students: 2336; session: 1517 |
| Sync: catch-up request latency | 0.01 s / 0.27 s / 0.67 s / 4.32 s (n=4370) |
| Sync errors | 0 |
| Database: peak connections / max, active, waiting on locks, commits/s, deadlocks | 41 / 200, 13, 5, 387, 0 |
| Load generator: peak event-loop delay p99, CPU, open requests, heap | 645 ms, 132%, 2149, 1371 MB |
| Data deleted after the step | modelCalls: 8910; classSessions: 33; assignments: 33; teachers: 33 |

