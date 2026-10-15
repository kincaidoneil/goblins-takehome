import type { BrowserContext } from "@playwright/test";
import { expect, test } from "../fixtures";

// A student opens "See worksheet" and zooms the page with the + and Fit width buttons, then
// taps a problem's cropped figure, which opens the worksheet zoomed to it.
// Runs where AUTH_MODE=local signs in a local teacher (CI's Docker stack); on a deploy, launch
// needs Google sign-in and the test skips.

expect.configure({ timeout: 20_000 });

const asOwnTeacher = (context: BrowserContext, baseURL: string) =>
  context.addCookies([
    { name: "gb_local_teacher", value: `e2e-${crypto.randomUUID()}`, url: baseURL },
  ]);

test("a student zooms the worksheet", async ({ classroom, baseURL }) => {
  test.setTimeout(120_000);
  const { teacher } = classroom;
  await asOwnTeacher(teacher.context(), baseURL ?? "http://localhost:3000");
  await teacher.goto("/setup/template/linear-relationships");
  await expect(teacher.locator(".setup-screen[data-hydrated]")).toBeVisible();
  await teacher.getByRole("button", { name: "Launch", exact: true }).click();
  const open = teacher.getByRole("button", { name: "Open the projector" });
  const signIn = teacher.getByRole("button", { name: "Sign in with Google to launch" });
  await expect(open.or(signIn)).toBeVisible();
  test.skip(await signIn.isVisible(), "launch needs Google sign-in on a deploy");
  const [projector] = await Promise.all([teacher.waitForEvent("popup"), open.click()]);
  await projector.close();
  const shown = await teacher.getByText(/^Code \d{6}$/).textContent();
  const code = (shown ?? "").replace(/\D/g, "");

  const [phone] = await classroom.students(1);
  if (phone === undefined) throw new Error("no phone");
  await phone.goto(`/join?code=${code}`);
  // A click before hydration submits the join form natively; retry until it takes.
  await expect(async () => {
    await phone.getByPlaceholder("Maya R.").fill("Zoe K.");
    await phone.getByRole("button", { name: "Join" }).click();
    await expect(phone).toHaveURL(/\/play\//, { timeout: 3_000 });
  }).toPass();
  await teacher.getByRole("button", { name: "Start", exact: true }).click();

  await phone.getByRole("button", { name: "See worksheet" }).click();
  const page = phone.getByRole("img", { name: /^Worksheet page \d+$/ });
  await expect(page).toHaveAttribute("data-scale", "1.00");
  await expect(phone.getByRole("button", { name: "Zoom out" })).toBeDisabled();
  await phone.getByRole("button", { name: "Zoom in" }).click();
  await expect(page).toHaveAttribute("data-scale", "1.50");
  await expect(phone.getByRole("status", { name: "Zoom level" })).toHaveText("150%");
  await phone.getByRole("button", { name: "Fit width" }).click();
  await expect(page).toHaveAttribute("data-scale", "1.00");
  await phone.getByRole("button", { name: "Back to my work" }).click();

  // Problem 2a shares problem 2's graph: its figure opens the worksheet zoomed in on it.
  await phone.getByRole("button", { name: "Problem 2a", exact: true }).click();
  await expect(phone.getByRole("heading", { name: "Problem 2a of" })).toBeVisible();
  await phone.getByRole("button", { name: /Zoom$/ }).click();
  await expect(page).toHaveAttribute("data-scale", /^(?!1\.00$)\d/);
});
