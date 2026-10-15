import { devices, type Page } from "@playwright/test";
import { expect, test } from "../fixtures";

// "Everything persists": a teacher and a student each come back on a fresh device and find their
// work. The teacher's second device signs in as the same teacher (AUTH_MODE=local with the same
// `gb_local_teacher` cookie); the student's second device rejoins with the same name.
//
// Runs where AUTH_MODE=local signs in a local teacher (CI's Docker stack); on a deploy, launch
// needs Google sign-in and the test skips.

// A new Electric shape takes a few seconds on first subscribe.
expect.configure({ timeout: 20_000 });

const TEMPLATE = "linear-relationships";
const TITLE = "Linear Relationships in Context";

/** A click that lands before hydration submits the join form natively; retry until it takes. */
const join = async (phone: Page, code: string, name: string) => {
  await phone.goto(`/join?code=${code}`);
  await expect(async () => {
    await phone.getByPlaceholder("Maya R.").fill(name);
    await phone.getByRole("button", { name: "Join" }).click();
    await expect(phone).toHaveURL(/\/play\//, { timeout: 3_000 });
  }).toPass();
};

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

const cell = (teacher: Page, student: string, problem: string) =>
  teacher.getByRole("button", { name: `${student}, problem ${problem}` }).getByRole("img");

test("a teacher and a student each return on a new device and find their work", async ({
  browser,
  classroom,
  baseURL,
}) => {
  test.setTimeout(150_000);
  const origin = baseURL ?? "http://localhost:3000";
  const teacherId = `e2e-${crypto.randomUUID()}`;
  const signInAs = { name: "gb_local_teacher", value: teacherId, url: origin };
  const { teacher } = classroom;
  await teacher.context().addCookies([signInAs]);
  await teacher.setViewportSize({ width: 1440, height: 900 });

  // Launch the template and run problem 1 for one student.
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
  const sessionUrl = teacher.url();
  const code = ((await teacher.getByText(/^Code \d{6}$/).textContent()) ?? "").replace(/\D/g, "");

  const [phone] = await classroom.students(1);
  if (phone === undefined) throw new Error("no phone");
  await join(phone, code, "Maya R.");
  await teacher.getByRole("button", { name: "Start", exact: true }).click();
  await expect(teacher.getByRole("button", { name: "End session" })).toBeVisible();
  await drawAndSubmit(phone, "1", "2a");
  await expect(cell(teacher, "Maya R.", "1")).toHaveAccessibleName("3/3");

  await test.step("the teacher's second device lists the class and opens its dashboard", async () => {
    const laptop = await browser.newContext({ ...devices["Desktop Chrome"], baseURL: origin });
    await laptop.addCookies([signInAs]);
    const second = await laptop.newPage();
    await second.setViewportSize({ width: 1440, height: 900 });
    await second.goto("/classes");
    const list = second.getByTestId("class-list");
    // A fresh teacher id, so this test's assignment is the only one.
    await expect(list.getByRole("listitem").filter({ hasText: TITLE })).toHaveCount(1);
    await expect(list.getByText("Live")).toBeVisible();
    await expect(list.getByText("1 student")).toBeVisible();
    await list.getByRole("link", { name: "Dashboard" }).click();
    await expect(second).toHaveURL(sessionUrl);
    await expect(cell(second, "Maya R.", "1")).toHaveAccessibleName("3/3");
    await laptop.close();
  });

  await test.step("the student rejoins on a new phone and picks up at problem 2a", async () => {
    await phone.context().close();
    const [newPhone] = await classroom.students(1);
    if (newPhone === undefined) throw new Error("no phone");
    await join(newPhone, code, "maya r.");
    await expect(newPhone.getByRole("heading", { name: "Problem 2a" })).toBeVisible();
    await expect(newPhone.getByRole("button", { name: "Problem 1, 3 out of 3" })).toBeVisible();
  });
});
