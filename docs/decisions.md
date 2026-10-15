# Decision log

One line of reasoning per decision. Newest last. The fixed decisions in [prd.md](prd.md#fixed-decisions) are not repeated here.

| Date | Area | Decision | Why |
|---|---|---|---|
| 2026-10-15 | Repo | Layout: `apps/web` plus `packages/{domain,ui,grader,mock-model,templates,evals,simulator,loadtest}` | One package per stream, as the PRD asks; the mock model gets its own package so its stream can work in parallel with the pipeline |
| 2026-10-15 | Repo | The orchestrator committed the bare workspace skeleton (`pnpm-workspace.yaml`, root `package.json`, `.gitignore`) to `main` directly | The repo was empty, so there was no `main` to open a PR against; every later change goes through a PR |
| 2026-10-15 | Repo | Infra and CI owns all root config; other streams touch only their own package | Root files are where parallel streams would collide |
| 2026-10-15 | Grader | `packages/grader` defines `ModelClient`, an Effect service whose one operation takes a model id and messages and returns the completion with usage and cost, or a typed error (rate limit, timeout, provider error, bad response). `packages/mock-model` provides a Layer for it | Lets the pipeline and mock streams start at once against one agreed interface; the grader stream may refine the shape in its first PR and tells the mock stream |
| 2026-10-15 | Secrets | Local secrets file is `.env.local` at the repo root | Read by Vite and the Vercel CLI by default |
| 2026-10-15 | Infra | Kincaid supplies `NEON_API_KEY` and `ELECTRIC_API_TOKEN`, not per-environment Electric source credentials | With API access, agents create Neon branches, enable logical replication and create an Electric source per preview from the CLI, so Kincaid does setup once |
| 2026-10-15 | Infra | `MODEL_CLIENT=mock` is the default everywhere; real calls need `MODEL_CLIENT=openrouter` | One explicit opt-in flag protects the $20 budget; the grader stream reads it |
| 2026-10-15 | Grader | `ModelClient.complete(request)` takes model, messages (text and image parts), a call tag (purpose, subject id, load-test run id) and optional max tokens, temperature and JSON schema; returns id, answering model, text and usage with provider-reported cost; errors are `RateLimited`, `Timeout`, `ProviderError`, `BadResponse`, with `isRetryable` | The tag carries what the call log needs without a second API; `purpose` maps onto the PRD's budget lines so the usage report can compare spend per line |
| 2026-10-15 | Grader | Effect 3 (`^3.22`), not Effect 4 | The PRD fixes `@effect/sql-drizzle`, whose latest release still requires Effect 3; every package should share one Effect major |
| 2026-10-15 | UI | Goblins' live site is goblins.com (goblins.ai does not serve it); the design language is measured from goblins.com and the public start of app.goblinsapp.com onboarding | Those are the only public surfaces; computed styles give exact colors, sizes and radii instead of guesses from screenshots |
| 2026-10-15 | UI | Nunito (OFL, via Fontsource) stands in for Goblins' ABC Ginto Rounded | Ginto Rounded is a paid license; Nunito has the same rounded terminals and heavy weights, and self-hosting avoids a Google Fonts request |
| 2026-10-15 | UI | Grade colors: lime for full credit, sun yellow for partial, soft peach for low, lilac for "needs you", dashed grey for "couldn't grade"; no red on student work | The PRD requires the product never make students anxious; lilac sits outside the score ramp so teachers read it as a different kind of cell |
| 2026-10-15 | UI | Tokens ship as plain CSS custom properties (`--gb-*`) plus a Tailwind v4 `@theme` file; the package exports source (no build step) | Works for plain CSS and Tailwind consumers alike; Vite compiles workspace TS and CSS directly, so a build adds nothing |
| 2026-10-15 | UI | Light theme only | Classrooms project in bright rooms and school laptops default to light; dark mode would double the visual QA for little use |
| 2026-10-15 | UI | Screenshots of goblins.com stay out of the repo; DESIGN.md links the live pages instead | They contain Goblins' logo and photos of real teachers |
