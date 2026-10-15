# Decision log

One line of reasoning per decision. Newest last. The fixed decisions in [prd.md](prd.md#fixed-decisions) are not repeated here.

| Date | Area | Decision | Why |
|---|---|---|---|
| 2026-10-15 | Repo | Layout: `apps/web` plus `packages/{domain,ui,grader,mock-model,templates,evals,simulator,loadtest}` | One package per stream, as the PRD asks; the mock model gets its own package so its stream can work in parallel with the pipeline |
| 2026-10-15 | Repo | The orchestrator committed the bare workspace skeleton (`pnpm-workspace.yaml`, root `package.json`, `.gitignore`) to `main` directly | The repo was empty, so there was no `main` to open a PR against; every later change goes through a PR |
| 2026-10-15 | Repo | Infra and CI owns all root config; other streams touch only their own package | Root files are where parallel streams would collide |
| 2026-10-15 | Grader | `packages/grader` defines `ModelClient`, an Effect service whose one operation takes a model id and messages and returns the completion with usage and cost, or a typed error (rate limit, timeout, provider error, bad response). `packages/mock-model` provides a Layer for it | Lets the pipeline and mock streams start at once against one agreed interface; the grader stream may refine the shape in its first PR and tells the mock stream |
| 2026-10-15 | Secrets | Local secrets file is `.env.local` at the repo root | Read by Vite and the Vercel CLI by default |
