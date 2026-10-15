import type { BrowserContext, Page } from "@playwright/test";
import { expect, test } from "../fixtures";

// Dashboard cases beyond the full loop (full-loop.spec.ts): renaming and splitting students, and
// "hide names and scores" staying on across a reload. Everything goes through the app's screens.
//
// Runs where AUTH_MODE=local signs in a local teacher (CI's Docker stack); on a deploy, launch
// needs Google sign-in and the test skips. The test signs in as its own teacher, because the hide
// setting is saved per teacher and must not leak into tests running alongside it.

// A new Electric shape takes a few seconds on first subscribe.
expect.configure({ timeout: 20_000 });

const TEMPLATE = "linear-relationships";

/** Signs this browser in as a teacher of its own, in local auth mode. */
const asOwnTeacher = (context: BrowserContext, baseURL: string) =>
  context.addCookies([
    { name: "gb_local_teacher", value: `e2e-${crypto.randomUUID()}`, url: baseURL },
  ]);

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

/** Draws a short stroke on the open problem's whiteboard and submits it. */
const drawAndSubmit = async (phone: Page, problem: string, next: string) => {
  const board = phone.getByRole("img", { name: `Whiteboard for problem ${problem}` });
  const box = await board.boundingBox();
  if (box === null) throw new Error(`whiteboard for problem ${problem} is not on screen`);
  await phone.mouse.move(box.x + 40, box.y + 40);
  await phone.mouse.down();
  for (let i = 1; i <= 10; i++) await phone.mouse.move(box.x + 40 + i * 15, box.y + 40 + i * 8);
  await phone.mouse.up();
  await phone.getByRole("button", { name: "Submit" }).click();
  await expect(phone.getByRole("heading", { name: `Problem ${next}` })).toBeVisible();
};

/** Launches the template and returns the join code, leaving the teacher on the dashboard. */
const launch = async (teacher: Page) => {
  await teacher.goto(`/setup/template/${TEMPLATE}`);
  await expect(teacher.locator(".setup-screen[data-hydrated]")).toBeVisible();
  await teacher.getByRole("button", { name: "Launch", exact: true }).click();
  const open = teacher.getByRole("button", { name: "Open the projector" });
  const signIn = teacher.getByRole("button", { name: "Sign in with Google to launch" });
  await expect(open.or(signIn)).toBeVisible();
  test.skip(await signIn.isVisible(), "launch needs Google sign-in on a deploy");
  const [projector] = await Promise.all([teacher.waitForEvent("popup"), open.click()]);
  await projector.close();
  await expect(teacher).toHaveURL(/\/sessions\/[0-9a-f-]{36}$/);
  const shown = await teacher.getByText(/^Code \d{6}$/).textContent();
  return (shown ?? "").replace(/\D/g, "");
};

test("the teacher renames and splits students, and hides names for a mirrored screen", async ({
  classroom,
  baseURL,
}) => {
  test.setTimeout(150_000);
  const { teacher } = classroom;
  await asOwnTeacher(teacher.context(), baseURL ?? "http://localhost:3000");
  await teacher.setViewportSize({ width: 1440, height: 900 });
  const code = await launch(teacher);

  // One phone does two students' work under one name: "maya r" joins and submits 1 and 2a.
  const [phone] = await classroom.students(1);
  if (phone === undefined) throw new Error("no phone");
  await join(phone, code, "maya r");
  await teacher.getByRole("button", { name: "Start", exact: true }).click();
  await expect(teacher.getByRole("button", { name: "End session" })).toBeVisible();
  await drawAndSubmit(phone, "1", "2a");
  await drawAndSubmit(phone, "2a", "2b");
  await expect(cell(teacher, "maya r", "1")).toHaveAccessibleName("3/3");
  await expect(cell(teacher, "maya r", "2a")).toHaveAccessibleName(/\d\/\d/);

  await test.step("rename fixes the capitalization", async () => {
    await teacher.getByRole("button", { name: "Actions for maya r" }).click();
    await teacher.getByRole("menuitem", { name: "Rename" }).click();
    await teacher.getByRole("dialog").getByRole("textbox").fill("Maya R.");
    await teacher.getByRole("dialog").getByRole("button", { name: "Rename" }).click();
    await expect(cell(teacher, "Maya R.", "1")).toHaveAccessibleName("3/3");
  });

  await test.step("split moves 2a to a second Maya", async () => {
    await teacher.getByRole("button", { name: "Actions for Maya R." }).click();
    await teacher.getByRole("menuitem", { name: "Split into two students" }).click();
    const split = teacher.getByRole("dialog");
    await split.getByRole("textbox").fill("Maya T.");
    await split.getByRole("checkbox", { name: /Problem 2a/ }).check();
    await split.getByRole("button", { name: /^Split/ }).click();
    await expect(cell(teacher, "Maya T.", "2a")).toHaveAccessibleName(/\d\/\d/);
    await expect(cell(teacher, "Maya R.", "1")).toHaveAccessibleName("3/3");
    await expect(teacher.getByRole("button", { name: "Maya R., problem 2a" })).toHaveCount(0);
  });

  await test.step("hide names and scores stays on after a reload", async () => {
    await teacher.getByRole("button", { name: "Hide names and scores" }).click();
    await expect(teacher.getByRole("button", { name: "Show names and scores" })).toBeVisible();
    await expect(teacher.getByText("Maya R.")).toHaveCount(0);
    await teacher.reload();
    await expect(teacher.getByRole("button", { name: "Show names and scores" })).toBeVisible();
    await expect(teacher.getByText("Maya R.")).toHaveCount(0);
    await teacher.getByRole("button", { name: "Show names and scores" }).click();
    await expect(teacher.getByText("Maya R.").first()).toBeVisible();
  });
});
