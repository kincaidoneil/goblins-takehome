# Task board

The orchestrator keeps this current. Sessions are named for their stream.

## Phase 1: started 2026-10-15

At most six sessions write code at once.

| Stream | Package | First deliverable | Status |
|---|---|---|---|
| Infra and CI | root, `.github/`, `e2e/` | Setup list for Kincaid; tooling, CI, Vercel project, E2E harness | Started |
| Web app lead | `packages/domain`, `apps/web` | Domain package (schema, migrations, types), then the app shell | Started |
| Design system | `packages/ui` | Goblins design language, tokens, Base UI components, Storybook, avatars | Started |
| Templates | `packages/templates` | 3–5 openly licensed math worksheets, one with geometry | Started |
| Grading pipeline | `packages/grader` | `ModelClient`, queue consumer, retries, call log, usage report | Started |
| Mock model and replay | `packages/mock-model` | Mock `ModelClient`: sampled latency and errors, scenarios, replay | Started |

## Waiting to start

| Stream | Starts when |
|---|---|
| AI quality | Templates exist |
| Landing page | Tokens exist |
| Class simulator | Domain package merged |
| Report | A writer slot frees up (works against fixture data) |
| Load test | A writer slot frees up; real runs once the pipeline is deployed |
| Writeup and recording | After the first full load run |

## Checkpoints

1. First working slice deployed
2. First eval report
3. First load run
4. Before submission: make the repo public and turn on branch protection for `main`, requiring CI
