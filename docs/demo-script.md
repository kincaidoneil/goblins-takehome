# Demo script

A 2–3 minute walkthrough recorded on production, https://goblins-takehome-three.vercel.app. Kincaid records it. It shows accurate grading, a student getting a problem wrong, and an ambiguous answer the teacher reviews, then the report, without grading the class by hand. Timings are rough; cut the waits in editing.

## Pre-flight

- [ ] **Signed in.** Use a demo Google account with no old assignments, so the assignments list and the report stay clean. Sign in before recording so launch skips the Google screen.
- [ ] **Real model on.** Production grades with `MODEL_CLIENT=openrouter`. Check with `vercel env ls production | grep MODEL_CLIENT`. The simulated class costs about $0.25 in real grades.
- [ ] **Spend checked.** `pnpm --filter @goblins/grader usage-report` shows what's left of the $20 key.
- [ ] **Phone ready.** Open the site on your phone, connected to the internet independently of the laptop, with screen mirroring or a camera on it for the recording. You join as "Kincaid O."
- [ ] **Windows placed.** Allow pop-ups for the site, since launch opens the projector in a new window. Put the dashboard on the left half of the screen and the projector on the right, both in frame.
- [ ] **Second terminal ready.** Repo on the latest `main`, `pnpm install` done, and the simulator command below typed in, with the join code left blank.
- [ ] **Tabs ready for the last beat.** Open the [production smoke test](../packages/loadtest/reports/smoke-production/report.md) and the [eval report](../packages/evals/REPORT.md) in background tabs.
- [ ] **Dry run.** Do one full run within the hour before recording, including the three phone problems. It also wakes the database and the sync server.
- [ ] **Quiet screen.** Notifications off, bookmarks bar hidden, browser zoom at 100%.

The simulator command for the second terminal. Fill in the join code from the projector:

```bash
pnpm demo:class --target https://goblins-takehome-three.vercel.app --code <join code> --template solving-linear-equations
```

What it does:

- 27 students join within about 20 s and wait in the lobby. Each works through all 8 problems over 1.5–2.5 minutes after you press Start, staggered so the grid fills visibly.
- Grades are real, from Haiku. The whiteboards are eval cases Haiku graded correctly in both eval runs.
- Most work is correct. On problems 7 and 8, 70% of students make a common mistake, so both land at about 65% and the report has a "where students struggled" section and the Goblins CTA. `--struggle 3,5` picks other problems.
- Four students submit unclear work on problems 2 and 4 that Haiku flags, so "Needs you" has items besides yours.
- It finishes by printing "Done: 27 students, 216 submissions, …", but you can end the session before then.
- It can't force a "couldn't grade" state. That only happens if the provider actually fails.

## What to write on the phone

The template is **Solving Linear Equations**. Its rubrics are the reference rubrics the grader was evaluated on, and on the eval's version of each case the grader gave these scores.

| Problem | Write | Expected grade |
|---|---|---|
| 1, correct. "Solve 3(x − 4) = 12x" | `3x − 12 = 12x`, then `−12 = 9x`, then `x = −4/3`, boxed | 2 / 2 |
| 8, wrong. "Do you agree with Elena?" | `Yes, I agree. 9x is bigger than 3x so they can't be equal.` | 0 / 2. What the grader read and its reason show it on the dashboard. |
| 6, ambiguous. "Where is Andre's mistake?" | `Line 4 is wrong, it should be 10 = 10x + 20`, then `−10 = 10x`, then `x = −7`. Then write a **1 over the 7** without erasing, so the last digit reads as either. | Needs you: the grader flags it as unclear and gives a best guess. |

Do problem 1, then jump to 8 and then 6 using the progress strip along the top.

The overwritten digit is the least predictable of the three. In the evals Haiku flagged 8 of 11 overwritten or ambiguous digits. If the dry run doesn't flag it, write two final answers instead, `x = −1` and `x = 1`, with neither crossed out. Haiku flagged all 3 two-answer cases in the evals.

## Beats

### 0:00 Setup from a template (30 s)

On the landing page, click **Start from a template**, then **Solving Linear Equations**. On the review screen, point at problem 1's rubric next to the original page. In the chat panel, type:

> make problem 2 worth 4 points

Show the rubric change.

> "A teacher starts from the worksheet they already have. Every problem gets an answer key and a rubric written like an AP scoring guide. I can edit anything, or just ask."

### 0:30 Launch (15 s)

Click **Launch**. The projector window opens with the join code and the QR code.

> "Sign-in comes only at launch. The projector shows a code, like Kahoot. Students join on any device with a first name."

### 0:45 The class joins (15 s)

Paste the code into the simulator command in the second terminal and run it. On your phone, enter the code and "Kincaid O." Avatars fill the projector lobby. Click **Start** on the dashboard.

> "To show a full class, 27 simulated students join on their own connections and submit real work. The same simulator drives the load test. I'm the 28th, on my phone."

### 1:00 One student, live (35 s)

Work the three problems from the table above while the other students work in the background.

1. **Problem 1, correct.** The full score shows on the transition, or fills in on the progress strip a few seconds later.
2. **Problem 8, wrong.** A low score, in a calm color, never red.
3. **Problem 6, ambiguous.** "Your teacher will check this one."

> "Students show their work one problem at a time. They see their score and move on. When the grader can't read something, the student never sees an error. The teacher gets it instead."

### 1:35 The dashboard (35 s)

The grid fills while you talk.

1. Open your own problem 8 cell. Point at what the grader read and the reason for 0 points.
2. Open the **Needs you** item for problem 6. Show the grader's best guess and why it's unsure. Click **Accept**, or enter a score.
3. Open any graded cell and change the score. Say that the student sees the change.

> "Grades land a few seconds after each submission. When the grader isn't sure, it doesn't guess. It asks me, with the reason. I can accept or rescore anything."

### 2:10 Report and the Goblins pitch (25 s)

End whenever the beats are covered: once the dashboard looks full and you've reviewed the flagged item. Don't wait for the simulator to finish. Grading already in progress still finishes, and those grades land in the report as it updates. Problems a simulated student hasn't submitted show as not submitted.

Click **End session**. The report opens.

1. The class summary, then the struggle section: the weakest problem and its common mistakes.
2. The CTA: "Give these N students practice on this in Goblins." Click it to show the handoff.
3. Click **Share this report** and open the link. The names are gone, and the page pitches Goblins to colleagues and administrators.

> "Ending the class gives me the report I'd have spent an evening on: where they struggled and why. One click sends exactly those students to Goblins to practice. The share link is how this reaches the department head."

### 2:35 How we know it holds up (15 s)

Switch to the eval report, then the smoke-test report.

> "Grading is Claude Haiku 5.5, picked over seven other cheap models. It gives the score a careful teacher would 96% of the time, for $0.0006 a grade, or $3.30 per teacher a month. The load test re-runs the testing-day spike on demand with a mocked model, so it's free to repeat. `[CAPACITY: TBD from the ramp]`."

End at about 2:50.
