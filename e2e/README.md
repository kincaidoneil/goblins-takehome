# End-to-end tests

Playwright tests in `tests/`. The `classroom` fixture in `fixtures.ts` opens a teacher, a projector and any number of students, each in its own browser context (its own device).

`tests/full-loop.spec.ts` is the definition of done for the core flow. A teacher launches a template, three students join on phones, draw and submit. Grades reach the dashboard live, the teacher accepts, retries and overrides, and the session ends in the report. Each of the six steps is a `test.step`, so a failure names the step.

## Running the full loop

All commands run from the repo root. `playwright.config.ts` loads Clerk keys from the root `.env.local`.

**1. Local stack, local sign-in.** This is what CI runs. Start Postgres and Electric, migrate, and run the app with `AUTH_MODE=local` (set in `apps/web/local.env`):

```bash
pnpm --filter @goblins/web db:up
DATABASE_URL=postgres://postgres:postgres@localhost:55432/goblins pnpm --filter @goblins/domain db:migrate
pnpm --filter @goblins/web dev
```

Then, in another terminal:

```bash
pnpm e2e:full
```

**2. Local stack, real Clerk sign-in.** Run the app without `AUTH_MODE=local` (for example `AUTH_MODE=clerk pnpm --filter @goblins/web dev`), then:

```bash
E2E_AUTH=clerk pnpm e2e:full
```

**3. A deploy, real Clerk sign-in:**

```bash
E2E_AUTH=clerk BASE_URL=https://goblins-takehome-three.vercel.app pnpm e2e:full
```

## Sign-in

With `E2E_AUTH=clerk`, `global-setup.ts` creates the teacher `e2e+clerk_test@example.com` on the Clerk development instance if it doesn't exist, and reuses it after that. Set `E2E_CLERK_USER_EMAIL` to use another address. `+clerk_test` addresses never receive mail; Clerk's test verification code is 424242. The setup refuses to run against a production Clerk instance (`pk_live_` key). Sign-in uses `@clerk/testing`'s token flow, so no email code is typed.

## Grades

Against `localhost`, grades come from the app's scripted mock, which reads the student's name. "Flag F." needs the teacher, "Fail F." fails its first attempt, and everyone else gets full marks, so the test asserts exact scores. Against a deploy, the grader decides. The test then checks that every grade lands, resolves whatever needs the teacher, and overrides one score. `E2E_SCRIPTED_GRADES=1` or `0` overrides the choice.

Each run is a new class session owned by the test teacher, so it never shows up on another teacher's dashboard.
