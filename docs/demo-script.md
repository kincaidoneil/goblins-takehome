# Demo script

A 2–3 minute walkthrough recorded on production, https://goblins-takehome-three.vercel.app. Kincaid records it. Timings are rough; cut the waits in editing.

## Pre-flight

- [ ] **Signed in.** Google sign-in on a demo account that has no old assignments, so the assignments list and the report are clean. Sign in before recording; the launch step then skips the Google screen.
- [ ] **Real model on.** Production grades with `MODEL_CLIENT=openrouter`. Check with `vercel env ls production | grep MODEL_CLIENT`. A class of 28 makes about 250 grades, roughly $0.15.
- [ ] **Spend checked.** `pnpm --filter @goblins/grader usage-report` shows what's left of the $20 key.
- [ ] **Whiteboards match the template.** The simulator submits the mock model's fixture whiteboards, which show `2x + 3 = 11`, not a template's problems. The real model grades those as wrong or flags them. Before recording, confirm with the class-simulator stream which template and whiteboard set give sensible grades on production. `[TBD: template id and simulator flags]`
- [ ] **Windows placed.** Allow pop-ups for the site, since launch opens the projector in a new window. Put the dashboard on the left half of the screen and the projector on the right, both in frame.
- [ ] **Second terminal ready.** Repo on the latest `main`, `pnpm install` done, the simulator command below typed in with the join code left blank.
- [ ] **Tabs ready for the last beat.** The load-test report and [packages/evals/REPORT.md](../packages/evals/REPORT.md) open in background tabs.
- [ ] **Dry run.** Do one full run within the hour before recording. It also wakes the database and sync server.
- [ ] **Quiet screen.** Notifications off, bookmarks bar hidden, browser zoom at 100%.

Simulator command (second terminal), with the code read off the projector:

```bash
pnpm --filter @goblins/simulator simulate \
  --url https://goblins-takehome-three.vercel.app \
  --join-code <code> --students 28 --time-scale 0.05
```

`--time-scale 0.05` gives each student 1–2 minutes of work instead of 20–40, so the dashboard fills while you talk. The same `--seed` gives the same names and whiteboards on every run.

## Beats

### 0:00 Landing (15 s)

Show the landing page. Scroll once past the graded worksheet.

> "This is Goblins Grader, a free auto-grader built to get teachers into Goblins. A teacher starts from the worksheet they were already going to hand out. No sign-up yet."

### 0:15 Setup and a chat edit (35 s)

Click **Start from a template** and pick the template from pre-flight. On the review screen, point at one problem's rubric, then type in the chat panel:

> "accept answers without the degree sign"

Show the rubric note change.

> "It pulls out every problem with an answer key and a rubric written like an AP scoring guide. I can edit any of it directly, or just ask."

### 0:50 Launch and the projector (15 s)

Click **Launch**. The projector window opens with the join code and QR code.

> "Launching asks for Google sign-in, the first time we ask for anything. The projector goes on the board: a code, like Kahoot. Students type it on any device with their first name."

### 1:05 The class joins (15 s)

Paste the code into the simulator command in the second terminal and run it. Avatars fill the projector lobby. Click **Start** on the dashboard.

> "These are 28 simulated students on their own devices, submitting whiteboard work at a testing-day pace. The same simulator drives our load test."

### 1:20 The dashboard fills (40 s)

Let cells fill for a few seconds. Then:

1. Open a lilac "needs you" cell. Show what the grader read, the points per rubric line and the reason. Click **Accept**; the panel moves to the next one.
2. Open a graded cell and change the score.
3. Toggle **Hide names and scores** on and off.

> "Grades land a few seconds after each submission. When the grader isn't sure, it doesn't guess. It asks me, with the reason. I can accept or rescore anything, and the student sees the change. If I'm mirroring my laptop to the projector, one click hides names."

### 2:00 Report and the Goblins pitch (30 s)

Click **End session**. The report opens.

1. The class summary and the weakest problem's common mistakes.
2. The CTA: "Give these N students practice on this in Goblins". Click it to show the handoff screen.
3. Click **Share this report** and open the link in a new tab: names are gone, and the page pitches Goblins to colleagues and administrators.

> "Ending the class gives me the report I'd have spent an evening on: where they struggled and the mistakes they made. One click sends exactly those students to Goblins to practice. The share link is how this spreads to the department head."

### 2:30 How we know it holds up (15 s)

Switch to the load-test report, then the eval report.

> "Grading is Claude Haiku 5.5, chosen over seven other cheap models. It matches the correct score 96% of the time, for $0.0006 a grade, or $3.30 per teacher a month. The load test re-runs the testing-day spike on demand with a mocked model, so it costs nothing to repeat. `[CAPACITY: TBD from the ramp]`."

End at about 2:45.
