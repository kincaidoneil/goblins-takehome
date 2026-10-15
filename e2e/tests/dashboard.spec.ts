import type { Page } from "@playwright/test";
import { expect, test } from "../fixtures";
import {
  canSeed,
  type Fixture,
  type SeededSession,
  seedSession,
  submit,
} from "../support/session-data";

// The teacher's live dashboard and the projector, with students on phones. Covers the PRD's
// quality bar for this area: the dashboard updating live, a flagged grade accepted, a failed
// grade retried, and an override reaching the student.
//
// Runs against a local server with AUTH_MODE=local, where every request is the local teacher.
// Students' names choose the scripted mock's outcome today ("flag", "fail"); their fixture
// whiteboards choose the same outcome once the app grades with @goblins/mock-model.
test.skip(!canSeed, "Needs DATABASE_URL and AUTH_MODE=local until setup lands in the app");
// A new Electric shape takes a few seconds on first subscribe.
expect.configure({ timeout: 15_000 });

const shot = async (page: Page, name: string) => {
  const dir = process.env.SCREENSHOT_DIR;
  if (dir === undefined) return;
  // Let entrances and grade animations settle so the capture shows the resting state.
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${dir}/${name}.png` });
};

/**
 * A student joins from their phone. A click that lands before hydration submits the form natively
 * and reloads the page, so try again until the app takes it. Joining twice resumes the student.
 */
const join = async (phone: Page, code: string, name: string) => {
  await phone.goto(`/join?code=${code}`);
  await expect(async () => {
    await phone.getByPlaceholder("Maya R.").fill(name);
    await phone.getByRole("button", { name: "Join" }).click();
    await expect(phone).toHaveURL(/\/play\//, { timeout: 3_000 });
  }).toPass();
};

/** A grid cell's score chip, whose accessible name is the grade. */
const cell = (page: Page, student: string, problem: string) =>
  page.getByRole("button", { name: `${student}, problem ${problem}` }).getByRole("img");

/** Submits work and asks the app to grade everything waiting, as the queue would. */
const submitAndGrade = async (
  page: Page,
  session: SeededSession,
  work: ReadonlyArray<readonly [student: string, problem: string, fixture: Fixture]>,
) => {
  for (const [student, problem, fixture] of work) await submit(session, student, problem, fixture);
  const response = await page.request.get("/api/grading/sweep?now=1");
  expect(response.ok()).toBe(true);
};

test("a class fills the dashboard live and the teacher resolves what needs them", async ({
  classroom,
}) => {
  test.setTimeout(120_000);
  const session = await seedSession();
  const { teacher, projector } = classroom;
  await teacher.setViewportSize({ width: 1440, height: 900 });
  await projector.setViewportSize({ width: 1440, height: 900 });
  await teacher.goto(`/sessions/${session.sessionId}`);
  await projector.goto(`/sessions/${session.sessionId}/projector`);
  await expect(projector.getByTestId("projector-code")).toHaveText(
    `${session.joinCode.slice(0, 3)} ${session.joinCode.slice(3)}`,
  );

  // Students join on their phones and appear on the projector.
  const names = ["Maya R.", "Flag F.", "Fail F."];
  const phones = await classroom.students(names.length);
  for (const [i, phone] of phones.entries()) await join(phone, session.joinCode, names[i] ?? "");
  await expect(projector.getByTestId("projector-joined")).toHaveText("3 students are here");
  for (const name of names) await expect(projector.getByText(name)).toBeVisible();
  await shot(projector, "projector-lobby");

  // The teacher starts from the projector; the dashboard follows.
  await projector.getByRole("button", { name: "Start" }).click();
  await expect(projector.getByTestId("projector-clock")).toBeVisible();
  await expect(teacher.getByRole("button", { name: "End session" })).toBeVisible();

  // Work arrives and is graded; the dashboard fills in without a reload.
  await submitAndGrade(teacher, session, [
    ["Maya R.", "1", "correct"],
    ["Flag F.", "1", "illegible"],
    ["Fail F.", "1", "fails-once"],
  ]);
  await expect(cell(teacher, "Maya R.", "1")).toHaveAccessibleName("2/2");
  await expect(cell(teacher, "Flag F.", "1")).toHaveAccessibleName(/check this/);
  await expect(cell(teacher, "Fail F.", "1")).toHaveAccessibleName(/Grading failed/);
  await expect(projector.getByTestId("projector-progress")).toHaveText("33%");
  await shot(teacher, "dashboard-live");
  await shot(projector, "projector-live");

  // A flagged grade: the teacher looks at the work and accepts the grader's best guess.
  await teacher.getByRole("button", { name: "Look at the work" }).click();
  const detail = teacher.getByRole("dialog");
  await expect(detail.getByText("What the grader read")).toBeVisible();
  await shot(teacher, "review-flagged");
  await detail.getByRole("button", { name: /^Accept / }).click();
  await expect(cell(teacher, "Flag F.", "1")).toHaveAccessibleName("2/2");

  // A failed grade: the teacher sends it back to the grader, and it comes back graded.
  await teacher.getByRole("button", { name: "Try again" }).click();
  await expect(cell(teacher, "Fail F.", "1")).toHaveAccessibleName("2/2");

  // Override a final score; the student's own progress strip shows the new score.
  await teacher.getByRole("button", { name: "Maya R., problem 1" }).click();
  await detail.getByRole("button", { name: "One point fewer" }).last().click();
  await shot(teacher, "review-override");
  await detail.getByRole("button", { name: "Change score to 1/2" }).click();
  await expect(cell(teacher, "Maya R.", "1")).toHaveAccessibleName("1/2");
  const maya = phones[0];
  if (maya === undefined) throw new Error("no phone");
  await expect(maya.getByRole("button", { name: "Problem 1, 1 out of 2" })).toBeVisible();

  // Hide names and scores for a mirrored screen; it stays on after a reload.
  await teacher.getByRole("button", { name: "Hide names and scores" }).click();
  await expect(teacher.getByRole("button", { name: "Show names and scores" })).toBeVisible();
  await expect(teacher.getByText("Maya R.")).toHaveCount(0);
  await teacher.reload();
  await expect(teacher.getByRole("button", { name: "Show names and scores" })).toBeVisible();
  await shot(teacher, "dashboard-hidden");
  await teacher.getByRole("button", { name: "Show names and scores" }).click();
  await expect(teacher.getByText("Maya R.").first()).toBeVisible();

  // End the session: the report opens, the projector wraps up, and new joins are refused.
  await teacher.getByRole("button", { name: "End session" }).click();
  await teacher.getByRole("button", { name: "End and see the report" }).click();
  await expect(teacher).toHaveURL(new RegExp(`/sessions/${session.sessionId}/report`));
  await expect(teacher.getByRole("heading", { name: "Linear equations" })).toBeVisible();
  await expect(projector.getByText("That's a wrap!")).toBeVisible();
  await shot(projector, "projector-ended");
  const [late] = await classroom.students(1);
  if (late === undefined) throw new Error("no phone");
  await late.goto(`/join?code=${session.joinCode}`, { waitUntil: "networkidle" });
  await late.getByPlaceholder("Maya R.").fill("Late L.");
  await late.getByRole("button", { name: "Join" }).click();
  await expect(late.getByText(/couldn't find that class/)).toBeVisible();
});

test("the teacher renames and splits students", async ({ classroom }) => {
  const session = await seedSession();
  const { teacher } = classroom;
  await teacher.setViewportSize({ width: 1440, height: 900 });
  const [phone] = await classroom.students(1);
  if (phone === undefined) throw new Error("no phone");
  await join(phone, session.joinCode, "maya r");

  await teacher.goto(`/sessions/${session.sessionId}`);
  await teacher.getByRole("button", { name: "Start" }).click();
  await expect(teacher.getByRole("button", { name: "End session" })).toBeVisible();
  await submitAndGrade(teacher, session, [
    ["maya r", "1", "correct"],
    ["maya r", "2", "correct"],
  ]);
  await expect(cell(teacher, "maya r", "2")).toHaveAccessibleName("2/2");

  // Rename: fix the capitalization.
  await teacher.getByRole("button", { name: "Actions for maya r" }).click();
  await teacher.getByRole("menuitem", { name: "Rename" }).click();
  await teacher.getByRole("dialog").getByRole("textbox").fill("Maya R.");
  await teacher.getByRole("dialog").getByRole("button", { name: "Rename" }).click();
  await expect(cell(teacher, "Maya R.", "1")).toHaveAccessibleName("2/2");

  // Split: problem 2 belonged to a second Maya.
  await teacher.getByRole("button", { name: "Actions for Maya R." }).click();
  await teacher.getByRole("menuitem", { name: "Split into two students" }).click();
  const split = teacher.getByRole("dialog");
  await split.getByRole("textbox").fill("Maya T.");
  await split.getByRole("checkbox", { name: /Problem 2/ }).check();
  await shot(teacher, "split-dialog");
  await split.getByRole("button", { name: /^Split/ }).click();
  await expect(cell(teacher, "Maya T.", "2")).toHaveAccessibleName("2/2");
  await expect(cell(teacher, "Maya R.", "1")).toHaveAccessibleName("2/2");
  await expect(teacher.getByRole("button", { name: "Maya R., problem 2" })).toHaveCount(0);
});
