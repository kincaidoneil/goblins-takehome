# Brief audit

2026-10-15, about 17:30 UTC. An independent read of the repo at `5f0c6fc` and the live app at https://goblins-takehome-three.vercel.app, written as a Goblins hiring panel would read them. I did not sign in, so the dashboard, projector and live report were checked only through code, E2E and load-test reports, not by hand. I did not test a worksheet upload.

## Requirements

| Requirement | Status | Evidence | Gap |
|---|---|---|---|
| **Brief 1.** Teacher creates an assignment and shares it | Met | Landing → template → `/setup/…` → Launch opens projector with code and QR (`e2e/tests/full-loop.spec.ts` step 1–2, `setup.spec.ts`) | Upload path not checked by me on production |
| **Brief 2.** Rubric generated, teacher can edit it | Met | Live: chat "make problem 4 worth 3 points" rewrote the rubric in ~5 s; inline +/− and point lines. Evals: 12/12 chat edits (`packages/evals/REPORT.md`) | The free-text grading note was not updated: problem 4 still says "earns both points" with 3 points. Template notes show internal text to teachers (below) |
| **Brief 3.** Whiteboard to show and submit work | Met | `/play`, `student-whiteboard.spec.ts` (offline outbox, 1024×768 PNG) | Phone whiteboard layout is a known open item; not checked with a live code |
| **Brief 4.** Student sees their score after each problem, continues to the next | Partly | Score shows on the 1.5 s transition if it has arrived, else fills in on the progress strip (PRD, Student work) | Production smoke: **4.1%** of grades arrived during the transition. So 96% of the time the student does not see the score when they submit. Defensible (no waiting on the grader), but it is a deviation from the brief and neither README nor writeup says so |
| **Brief 5.** Teacher gets a report of each student's progress and grades | Met | `/report/demo` live: completion, distribution, per-problem averages, common mistakes with names; `report.spec.ts` | Live dashboard and real report not checked by hand |
| **Brief 6.** Everything persists across browsers and devices | Met | Students resume by typing the same name (ramp: 53 resumes, 0 failed); teachers via Clerk; Postgres | Pre-launch drafts belong to a cookie until sign-in, so they don't follow the teacher to another device. Reasonable; say so |
| **Part 1.** Minimal slice a teacher would enjoy, students love learning | Mostly met | Landing, setup, report are polished and on-brand; warm student copy; deliberate cuts listed in README | Reviewer can't see the student or dashboard side without signing in and opening phones. Teacher-facing internal strings (below) |
| **Part 2a.** Push realistic testing-day load, see where it slows and breaks | Partly | Simulator + `loadtest ramp`, bell spread, per-step pass/fail and first-failing component (`packages/loadtest/reports/`) | The only ramp step (990, one local Node process) failed and was not followed by a run that models production. Production saw one class of 30 |
| **Part 2b.** Run it repeatedly and cheaply | Met | Mock model with sampled latency and scenarios; ledger shows $0.004 of QStash per smoke run | Running it against production needs `LOAD_TEST_TOKEN`, which Goblins doesn't have. README doesn't say how they get it |
| **Part 2c.** Trust it enough for a ship / no-ship call | Missing | Criteria set before the runs (PRD) | `docs/writeup.md` has `[TBD]` for capacity, every criterion and the call itself. `provider-down` and `rate-limit-storm` never ran |
| **Writeup.** Statement of confidence with 1k → 10k → 100k → 1M | Partly | Scale table with cost, peak grades/s and what changes per step (`docs/writeup.md`) | Marked "Draft for Kincaid to edit"; "today" section is TBD. The 1,000 row says "nothing else" changes, but the 990-student run failed first on sync (Electric), and production runs one Electric machine |
| **Effect** (preference) | Met | Effect 3 services, typed errors and Layers across grader, domain, mock model, simulator and server routes (94 source files import `effect`) | None |
| **Deliverable:** publicly hosted app | Met | https://goblins-takehome-three.vercel.app | Production QStash is on the free plan: 1,000 messages/day, about 3 classes. Reviewers trying it the same day as a demo recording could hit it |
| **Deliverable:** the repo | **Missing** | `gh repo view`: `PRIVATE` | Goblins can't read it. Make it public or invite the reviewers |
| **Deliverable:** 2–3 min recording (optional in brief, required by PRD) | Missing | `docs/demo-script.md` has a `[TBD]` for the template and simulator flags | Not recorded |
| **Deliverable:** README with decisions made and deferred | Met | README: approach, product decisions, technical overview, deferred list | "Load: capacity pending" in Results |
| **PRD goal:** saves time (worksheet → launch < 5 min) | Partly | Template to launch-ready took me under a minute | Never timed for an uploaded worksheet; not stated anywhere |
| **PRD goal:** accurate | Partly | 96% exact, 7% flagged, 7 of 219 wrong and unflagged (`REPORT.md`) | All 230 whiteboards are font-rendered. The planned 5–10 hand-drawn check was dropped. This is the brief's central product question |
| **PRD goal:** cheap | Met | $0.00057 per grade, $3.30 per teacher-month (`REPORT.md`, from checked-in cache) | None |
| **PRD goal:** kind to students | Partly | Warm copy, no red on student work, "Teacher will check" instead of errors | Phone layout and diagram crops still open (PR #96 open) |
| **PRD goal:** reliable under load | Partly | 0 lost submissions in every run; idempotent writes, lease, sweeper | Capacity not found; ship bar (≥ 1,000 students) not shown; provider-down not run |
| **PRD goal:** leads to Goblins | Met | Report CTA names the students and skills; share page hides names and pitches Max (`/share/demo`) | The handoff is a labeled demo screen (no Goblins API). Fine, and said |

## First five minutes: what hurts, ranked

1. **The repo is private.** The brief's second deliverable can't be opened.
2. **Part 2's answer is missing.** README says "capacity pending"; the writeup opens with "Draft for Kincaid to edit" and `[TBD]` in five cells and the ship call. The brief says the infra is what they care about most.
3. **The only ramp failed and the explanation doesn't hold for production.** The 990-student report blames one Node process, but its first failing component is sync, and production also runs a single Electric machine. A reviewer will ask why there's no run with several app processes.
4. **Internal text shown to teachers.** On `/setup` for Angle Relationships, problem 8's note reads "The key follows the diagram (138°), not IM's alt text (128°); Kincaid confirmed this," and notes say "earns L2 and L3" and "L1 can be shown…". Rubric line ids are never shown to the teacher, so these read as leaked internals.
5. **Small inconsistencies a careful reviewer clicks into:** the landing card says Angle Relationships has 8 problems, setup says 9; `/join` says "Goblins", the decision log says "Goblins Grader everywhere"; `/join` accepts any six digits and rejects a bad code only after the student types their name.
6. **Stale docs next to the README.** `docs/prd.md` Fixed decisions still say Vercel Queues, Electric Cloud and Blob, with no superseded note. `docs/board.md` still shows Phase 1 "Started". The decision log has duplicate rows (Landing name, mock extraction, template images) and names a QStash resource `mcp-workouts-qstash`.

## The 5 highest-value fixes

1. **Close Part 2 with a real number and a call** (load test, then writeup). Run the ramp with the app as 3–4 processes behind a local proxy (or on Vercel if Kincaid gets approval), using the measured Haiku profile, and run `provider-down` at one step. Fill every `[TBD]`. If 990 still fails, the writeup states "no-ship at 1,000 until X," names the component, and the fix. A clear no-ship with a cause is worth more than TBDs.
2. **Make the repo readable and record the demo** (infra, Kincaid). Public repo or reviewer invites; README link to the recording. Fill the demo script's `[TBD]` first.
3. **Clean teacher-facing template text and keep notes in step with chat edits** (setup). Strip `Kincaid`, `L1/L2/L3` and IM alt-text notes from the four templates' grading notes. When chat changes a problem's points, rewrite or drop notes that state a point count ("earns both points"); the grader reads these notes as rules, so a stale one can change grades.
4. **Five hand-drawn whiteboards through the eval** (AI quality, with Kincaid drawing for 15 minutes). Even five cases turn "upper bound" into a measured check and cost about a cent.
5. **Docs hygiene and a reviewer path** (writeup, web app). Mark superseded rows in the PRD's Fixed decisions, update or delete `board.md`, de-duplicate the decision log. Add "See a sample report" to the landing page, since a reviewer can't see the payoff without running a class. State the Brief 4 deviation (score on the progress strip, 4% during the transition) as a decision in the README.

## Unverified or overclaimed

- **"Latency sampled from 1,839 real Haiku calls"** (writeup, "What we haven't verified"). Both runs the writeup cites, `smoke-production` and `ramp-local-qstash`, used the `seed` profile, which their headers call "guessed, not measured". Either rerun on the measured profile or correct the sentence.
- **"Electric Cloud shut down mid-build"** (README). The decision log's evidence is "its hosts no longer resolve." That is a public claim about a vendor based on DNS. Say "we couldn't reach Electric Cloud and self-hosted Electric on Fly" unless there's a shutdown notice to link.
- **"1,000 students: QStash to pay-as-you-go. Nothing else"** (writeup scale table). Contradicted by the 990 run, where sync and the database failed first. Not shown in production either.
- **"Vercel runs many instances; this is a per-process ceiling, not the deployed one"** (loadtest reports README). Plausible for the app, unshown for Electric, which is one Fly machine in production.
- **Whiteboard storage.** The writeup says production stores whiteboards inline in Postgres as `data:` URLs; the `smoke-production` header lists Blob. One is wrong.
- **Two production URLs.** The smoke test targeted `goblins-takehome-gathers.vercel.app`; the README links `goblins-takehome-three.vercel.app`. Say they are the same deployment, or rerun against the public one.
- **"Peak grades/s: 6 at 1,000 students"** assumes submissions are spread evenly over 30 minutes. The ramp measured peaks well above the mean at the bell (57/s peak against 10.3/s mean at 4× compression). The table should use a peak-to-mean factor from the runs.
- **96% accuracy** is stated with the "upper bound" caveat everywhere it appears. That's honest; it stays a gap until fix 4 lands.
