# @goblins/simulator

Simulated classes for the Goblins auto-grader. Each student joins with a code and a name, subscribes to the same Electric shapes as the student app, submits pre-drawn whiteboards at a testing-day pace, and sometimes closes the tab and resumes on a "new device" by retyping their name. Each teacher creates an assignment from a template, opens a session, starts it at the bell and keeps the dashboard subscribed, then checks that the dashboard matches what the students did.

It talks to the app only over HTTP, as a browser would. Three uses:

- **E2E at scale**: many full classes at once, with every dashboard checked.
- **The recorded demo**: a real teacher launches a session; `--join-code` sends a class into it, and their dashboard and projector fill up live. The same `--seed` gives the same names, schedule and whiteboards.
- **The load test's client**: see [`@goblins/loadtest`](../loadtest).

The recorded demo uses its own command, with eval-dataset whiteboards the real grader is known to grade right:

```bash
# 27 students join session 123456 on production and finish every problem in 2–3 minutes
pnpm demo:class --target https://goblins-takehome-gathers.vercel.app --code 123456 --template solving-linear-equations
```

Most students submit correct work. On two "struggle" problems (default: the last two the eval set has common mistakes for; set with `--struggle 7,8`) 70% of students make a common mistake, so the report shows where the class struggled and the Goblins CTA. Four students submit ambiguous work the grader flagged in every eval run, so "Needs you" has items to review. The class is not tagged as a load test, so the app grades it with its real model (about $0.25 for 27 × 8 grades with Haiku).

```bash
# Demo with fixture whiteboards: 30 students join session 123456 and finish in 2–4 minutes
pnpm --filter @goblins/simulator simulate --url https://<app> --join-code 123456 --time-scale 0.1

# Five load-test classes (needs LOAD_TEST_TOKEN; data stays until `loadtest cleanup <run id>`)
LOAD_TEST_TOKEN=… pnpm --filter @goblins/simulator simulate --url https://<app> --classes 5
```

A demo class joins a real session, so the app grades it as it grades any class: with the real model in production, about 270 grades per class of 30.

## Whiteboards

The mock model's fixtures (`packages/mock-model/fixtures`), in a fixed mix: correct 50%, partial 20%, wrong 15%, blank 5%, illegible 10%. The mock recognizes each by its SHA-256, so every grade is predictable. Fixtures scripted to fail are left out, since they would count against the failure criterion by design. The eval dataset's simulator subset will join the mix when it lands.

## The HTTP contract

`src/api.ts` holds the routes and their JSON. They were proposed to the web app stream; until the app serves them, `@goblins/loadtest`'s stand-in does.

| Route | Who | Body → response |
|---|---|---|
| `POST /api/join` | student | `{joinCode, name}` → `{sessionId, studentId, displayName, avatarId, resumed, problems}` and the `gb_student_<sessionId>` cookie; 404 unknown code |
| `POST /api/submit` | student (cookie) | multipart `sessionId, problemId, submittedAt, whiteboard` → `{submissionId, isNew}`; 409 `{reason}` |
| `GET /api/shape?view=&sessionId=` | both | Electric shape proxy: `my-session`, `my-grades` (student); `session`, `students`, `grades` (teacher) |
| `POST /api/teacher/assignments` | teacher | `{templateId}` → `{assignmentId, problems}` |
| `POST /api/teacher/sessions` | teacher | `{assignmentId}` → `{sessionId, joinCode}` |
| `POST /api/teacher/sessions/:id/start`, `/end` | teacher | → 200 |

## Pacing

`src/pacing.ts` plans every class from a seed. Classes start 1–3 minutes into the run (a 1-minute lobby, then a 2-minute bell spread). Students join during the lobby, 10% up to 5 minutes late. Each works for 20–40 minutes with uneven gaps between problems. `--time-scale` multiplies every interval.
