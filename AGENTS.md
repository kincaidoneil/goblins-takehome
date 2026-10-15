# Goblins auto-grader

A free auto-grader for teachers, built as Kincaid's take-home for Goblins. Read [docs/prd.md](docs/prd.md) before doing anything: it holds the objective, scope, user flows, fixed decisions, quality bar and execution plan, with the original brief at the end. This work is judged as a hiring deliverable. Good enough is not enough.

Other docs:

- [docs/decisions.md](docs/decisions.md): the decision log. Add one line of reasoning for every call the PRD leaves open.
- [docs/board.md](docs/board.md): the task board. The orchestrator keeps it current.

## Repo layout

pnpm monorepo. Each workstream owns one package and does not edit another stream's package without asking the orchestrator.

| Path | Owner stream | Contents |
|---|---|---|
| `apps/web` | Web app lead (landing page and report streams own their routes) | TanStack Start app: teacher, student, projector, dashboard, report |
| `packages/domain` | Web app lead | Drizzle schema, migrations, shared types and Effect schemas |
| `packages/ui` | Design system | Tokens, Base UI components, Storybook, avatars |
| `packages/grader` | Grading pipeline | Queue consumer, `ModelClient` interface, OpenRouter client, retries, call log, usage report |
| `packages/mock-model` | Mock model and replay | `ModelClient` mock: sampled latency and errors, scenarios, replay |
| `packages/templates` | Templates | Openly licensed worksheets and their metadata |
| `packages/evals` | AI quality | Datasets, generated whiteboards, eval harness, reports |
| `packages/simulator` | Class simulator | Simulated students driving a real session |
| `packages/loadtest` | Load test | Testing-day load, per-step pass/fail reports |
| Root config, `.github/`, `e2e/` | Infra and CI | Tooling, CI, Vercel wiring, E2E harness |

## How to work

- Each task gets its own worktree, branch and small PR against `main`. Merging to `main` deploys to production.
- Before opening a PR, review your own diff. Then wait for CI and the Codex review, address every comment (fix it, or reply with a reason), rebase on `main`, and merge when green. You own your PR until it merges.
- Done means evidence: CI and E2E passing, screenshots for UI, a preview URL. Say what you did not verify.
- Never stop to wait for an answer. Record the assumption in `docs/decisions.md` and keep going. Send questions for Kincaid to the orchestrator session, each with a recommendation.
- If Kincaid gives you feedback directly that changes a decision, the scope or another stream's work, tell the orchestrator.

## Code

- TypeScript, strict. No `any`, no casts to silence the compiler. Validate foreign data with Effect Schema.
- Effect for server code. Model failures as typed errors in the return type; expose an error only when callers act on it differently.
- Make impossible states impossible: tagged unions and state machines over flags.
- Keep it simple. Do not build for scale the PRD does not ask for.
- End-to-end tests (Playwright) over unit tests. Unit tests only where logic is dense.
- UI components get Storybook stories. Check UI changes by screenshot.

## Models and money

- The OpenRouter key holds $20 for the whole project. Development, tests and CI use the mock model by default. Real calls need an explicit opt-in flag.
- Every model call is logged with latency, status, tokens and cost.

## Secrets

- Local secrets live in `.env.local` at the repo root (gitignored). Never commit secrets and never paste them into chat, PRs or logs.
- Agents do not create accounts, sign in, or type keys into web forms. Kincaid does that; agents use the CLIs afterward.

## Writing

Plain, direct, specific. No filler, no metaphors where a literal phrase exists. This applies to code comments, docs, commit messages and PRs.
