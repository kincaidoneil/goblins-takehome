import type { Page } from "@playwright/test";
import { signInTeacher } from "../auth";
import { expect, test } from "../fixtures";

// The whole loop through the app's own screens, with no seeded data: a teacher launches a
// template, three students join on phones, draw and submit, grades reach the dashboard live,
// the teacher resolves what needs them, and the session ends in the report.
//
// Three ways to run it (e2e/README.md): against the local stack with AUTH_MODE=local, against the
// local stack with a real Clerk sign-in, or against a deploy with a real Clerk sign-in.
//
// Against a local server, grades come from the app's scripted mock, which reads the student's
// name: "Flag" needs the teacher, "Fail" fails its first attempt, anyone else gets full marks.
// Against a deploy the grader decides, so the test checks that every grade lands and that the
// teacher can resolve whatever needs them, without expecting particular scores.

// A new Electric shape takes a few seconds on first subscribe.
expect.configure({ timeout: 20_000 });

const TEMPLATE = "linear-relationships";
const TITLE = "Linear Relationships in Context";
const STUDENTS = ["Maya R.", "Flag F.", "Fail F."] as const;
const scripted =
  process.env.E2E_SCRIPTED_GRADES === undefined
    ? /\/\/(localhost|127\.0\.0\.1)[:/]/.test(
        process.env.BASE_URL ?? process.env.E2E_BASE_URL ?? "http://localhost:3000",
      )
    : process.env.E2E_SCRIPTED_GRADES === "1";
/** Accessible names of a cell whose grade has landed: a score, needs you, or couldn't grade. */
const LANDED = /^\d+\/\d+$|check this|Grading failed/;

/** A grid cell's score chip, whose accessible name is the grade. */
const cell = (teacher: Page, student: string, problem: string) =>
  teacher.getByRole("button", { name: `${student}, problem ${problem}` }).getByRole("img");

/** A click that lands before hydration submits the join form natively; retry until it takes. */
const join = async (phone: Page, code: string, name: string) => {
  await phone.goto(`/join?code=${code}`);
  await expect(async () => {
    await phone.getByPlaceholder("Maya R.").fill(name);
    await phone.getByRole("button", { name: "Join" }).click();
    await expect(phone).toHaveURL(/\/play\//, { timeout: 3_000 });
  }).toPass();
};

/** Draws a short diagonal stroke on the open problem's whiteboard. */
const draw = async (phone: Page, problem: string) => {
  const board = phone.getByRole("img", { name: `Whiteboard for problem ${problem}` });
  const box = await board.boundingBox();
  if (box === null) throw new Error(`whiteboard for problem ${problem} is not on screen`);
  await phone.mouse.move(box.x + 40, box.y + 40);
  await phone.mouse.down();
  for (let i = 1; i <= 10; i++) await phone.mouse.move(box.x + 40 + i * 15, box.y + 40 + i * 8);
  await phone.mouse.up();
};

test("a teacher runs a class from template to report", async ({ classroom }) => {
  test.setTimeout(180_000);
  // The projector opens as a popup from the teacher's window, as it does for a real teacher.
  const { teacher } = classroom;
  await teacher.setViewportSize({ width: 1440, height: 900 });

  let projector: Page | undefined;
  let code = "";

  await test.step("1. teacher picks a template, reviews it and launches", async () => {
    await signInTeacher(teacher);
    await teacher.goto(`/setup/template/${TEMPLATE}`);
    await expect(teacher.locator(".setup-screen[data-hydrated]")).toBeVisible();
    await expect(teacher.getByRole("textbox", { name: "Assignment name" })).toHaveValue(TITLE);
    await expect(teacher.getByRole("article", { name: "Problem 1", exact: true })).toBeVisible();
    await teacher.getByRole("button", { name: "Launch", exact: true }).click();
    const open = teacher.getByRole("button", { name: "Open the projector" });
    const signIn = teacher.getByRole("button", { name: "Sign in with Google to launch" });
    await expect(open.or(signIn)).toBeVisible();
    test.skip(await signIn.isVisible(), "not signed in: run with E2E_AUTH=clerk on a deploy");
    const [popup] = await Promise.all([teacher.waitForEvent("popup"), open.click()]);
    projector = popup;
    await expect(teacher).toHaveURL(/\/sessions\/[0-9a-f-]{36}$/);
  });
  if (projector === undefined) throw new Error("the projector did not open");
  const screen = projector;

  await test.step("2. the projector shows the join code", async () => {
    await expect(screen).toHaveURL(/\/sessions\/[0-9a-f-]{36}\/projector$/);
    const shown = screen.getByTestId("projector-code");
    await expect(shown).toHaveText(/^\d{3} \d{3}$/);
    code = ((await shown.textContent()) ?? "").replace(/\s/g, "");
    await expect(teacher.getByText(`Code ${code}`)).toBeVisible();
  });

  const phones = await classroom.students(STUDENTS.length);
  const phoneOf = (name: (typeof STUDENTS)[number]) => {
    const phone = phones[STUDENTS.indexOf(name)];
    if (phone === undefined) throw new Error(`no phone for ${name}`);
    return phone;
  };

  await test.step("3. three students join, draw and submit problem 1", async () => {
    for (const name of STUDENTS) await join(phoneOf(name), code, name);
    await expect(screen.getByTestId("projector-joined")).toHaveText("3 students are here");
    for (const name of STUDENTS) await expect(screen.getByText(name)).toBeVisible();

    await screen.getByRole("button", { name: "Start" }).click();
    await expect(teacher.getByRole("button", { name: "End session" })).toBeVisible();

    for (const name of STUDENTS) {
      const phone = phoneOf(name);
      await draw(phone, "1");
      await phone.getByRole("button", { name: "Submit" }).click();
      // Submitting moves the student on and locks problem 1 in their progress strip.
      await expect(phone.getByRole("heading", { name: "Problem 2a" })).toBeVisible();
    }
  });

  await test.step("4. grades appear live on the dashboard", async () => {
    if (!scripted) {
      for (const name of STUDENTS)
        await expect(cell(teacher, name, "1")).toHaveAccessibleName(LANDED);
      return;
    }
    await expect(cell(teacher, "Maya R.", "1")).toHaveAccessibleName("3/3");
    await expect(cell(teacher, "Flag F.", "1")).toHaveAccessibleName(/check this/);
    await expect(cell(teacher, "Fail F.", "1")).toHaveAccessibleName(/Grading failed/);
    await expect(teacher.getByRole("region", { name: /Needs you/ })).toContainText("Flag F.");
    // Students see a score only once it is final.
    await expect(
      phoneOf("Maya R.").getByRole("button", { name: "Problem 1, 3 out of 3" }),
    ).toBeVisible();
    await expect(
      phoneOf("Flag F.").getByRole("button", {
        name: "Problem 1, your teacher will check this one",
      }),
    ).toBeVisible();
  });

  await test.step("5. teacher accepts, retries and overrides; students see the result", async () => {
    const detail = teacher.getByRole("dialog");
    const lookAtWork = teacher.getByRole("button", { name: "Look at the work" });
    const tryAgain = teacher.getByRole("button", { name: "Try again" });

    // Accept the flagged best guess.
    if (scripted || (await lookAtWork.count()) > 0) {
      await lookAtWork.first().click();
      await expect(detail.getByText("What the grader read")).toBeVisible();
      await detail.getByRole("button", { name: /^Accept / }).click();
      if (scripted) {
        await expect(cell(teacher, "Flag F.", "1")).toHaveAccessibleName("3/3");
        await expect(
          phoneOf("Flag F.").getByRole("button", { name: "Problem 1, 3 out of 3" }),
        ).toBeVisible();
      }
    }

    // Send a failed grade back to the grader; the retry succeeds.
    if (scripted || (await tryAgain.count()) > 0) {
      await tryAgain.first().click();
      if (scripted) await expect(cell(teacher, "Fail F.", "1")).toHaveAccessibleName("3/3");
    }

    // Override a final score; the student's progress strip follows.
    await expect(cell(teacher, "Maya R.", "1")).toHaveAccessibleName(/^\d+\/\d+$/);
    const before = (await cell(teacher, "Maya R.", "1").getAttribute("aria-label")) ?? "";
    const [points = 0, max = 0] = before.split("/").map(Number);
    await teacher.getByRole("button", { name: "Maya R., problem 1" }).click();
    const target = points > 0 ? points - 1 : points + 1;
    const step = points > 0 ? "One point fewer" : "One point more";
    await detail.getByRole("button", { name: step }).last().click();
    await detail.getByRole("button", { name: `Change score to ${target}/${max}` }).click();
    await expect(cell(teacher, "Maya R.", "1")).toHaveAccessibleName(`${target}/${max}`);
    await expect(
      phoneOf("Maya R.").getByRole("button", { name: `Problem 1, ${target} out of ${max}` }),
    ).toBeVisible();
  });

  await test.step("6. teacher ends the session and the report opens", async () => {
    await teacher.getByRole("button", { name: "End session" }).click();
    await teacher.getByRole("button", { name: "End and see the report" }).click();
    await expect(teacher).toHaveURL(/\/sessions\/[0-9a-f-]{36}\/report$/);
    await expect(teacher.getByRole("heading", { name: TITLE })).toBeVisible();
    await expect(screen.getByText("That's a wrap!")).toBeVisible();
  });
});
