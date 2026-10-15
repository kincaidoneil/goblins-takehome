# Task board

The orchestrator keeps this current. Sessions are named for their stream. As of 2026-10-15, before submission.

## Streams

| Stream | Package | Status |
|---|---|---|
| Infra and CI | root, `.github/`, `e2e/` | Done: CI, E2E in Docker, Vercel and Fly deploys |
| Web app lead | `packages/domain`, `apps/web` | Done; ongoing fixes |
| Design system | `packages/ui` | Polishing the student phone screen (#97) |
| Templates | `packages/templates` | Done: four Illustrative Mathematics worksheets |
| Grading pipeline | `packages/grader` | Done: QStash consumer, retries, sweeper, call log, spend cap |
| Mock model and replay | `packages/mock-model` | Done: profile measured from 1,839 real Haiku calls |
| AI quality | `packages/grader/src/ai`, `packages/evals` | Done: [eval report](../packages/evals/REPORT.md) |
| Eval dataset | `packages/evals/datasets` | Done: 230 generated whiteboards |
| Assignment setup | `apps/web` | Done: extraction, review, chat edits, launch |
| Dashboard | `apps/web` | Done |
| Report | `apps/web/src/report` | Done |
| Class simulator and load test | `packages/simulator`, `packages/loadtest` | Running capacity reruns; 6-process ramp in review (#99) |
| Writeup and recording | `README.md`, `docs/` | README, demo script and writeup draft merged; capacity numbers pending |
| Brief audit | `docs/brief-audit.md` | In review (#98); fixes applied to the writeup and docs |

## Open before submission

- Load-test capacity with the measured latency profile, then the ship / no-ship call in [writeup.md](writeup.md) and the README.
- The simulator command for the demo's 27 students.
- Kincaid's edits to the README, and the recording.

## Checkpoints

1. First working slice deployed: done
2. First eval report: done
3. First load run: done
4. Before submission: in progress
