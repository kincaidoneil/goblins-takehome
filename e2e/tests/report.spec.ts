import { devices, type Locator } from "@playwright/test";
import { expect, test } from "../fixtures";

/** Clicks until the dialog opens: a click that lands before hydration does nothing. */
const openDialog = (button: Locator, dialog: Locator) =>
  expect(async () => {
    await button.click();
    await expect(dialog).toBeVisible({ timeout: 1_000 });
  }).toPass();

// The sample report and its shared page run on fixture data, so they need no class session.
// The live report is covered by the classroom flow once the dashboard can end a session.

const STUDENT_NAMES = ["Maya R.", "Jordan T.", "Liam P.", "Sofia M.", "Ava L.", "Chloe B."];

test("the teacher's report shows where the class struggled and hands off to Goblins", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/report/demo");

  await expect(page.getByRole("heading", { name: "Solving Linear Equations" })).toBeVisible();
  await expect(page.getByTestId("pending-banner")).toContainText("4 grades aren’t final yet");
  await expect(page.getByText("26/28")).toBeVisible();

  // Weak problems, weakest first, with grouped mistakes and the students who made them.
  const struggles = page.getByRole("region", { name: "Where students struggled" });
  const problems = struggles.getByRole("heading", { level: 3 });
  await expect(problems).toHaveText([
    "Distributing a negative sign",
    "Finding the error in a worked solution",
  ]);
  const problem7 = page.locator("#problem-p7");
  await expect(problem7).toContainText("still turned −(5 − 9y) into −5 − 9y");
  await expect(problem7).toContainText("Jordan T.");
  await expect(problem7).toContainText(
    "2 grades on this problem aren’t final yet (Ava L., James O.)",
  );

  // The CTA names exactly the students who missed the weak problems.
  const cta = page.getByTestId("practice-cta");
  await expect(cta).toContainText("Give these 13 students practice on this in Goblins");
  const handoff = page.getByRole("dialog", { name: "Here’s what Goblins will create" });
  await openDialog(cta.getByRole("button", { name: "Create practice in Goblins" }), handoff);
  await expect(handoff).toContainText("This step is a demo.");
  await expect(handoff).toContainText("Liam P.");
  const goblins = handoff.getByRole("link", { name: "Open Goblins" });
  const href = new URL((await goblins.getAttribute("href")) ?? "");
  expect(href.origin + href.pathname).toBe("https://app.goblinsapp.com/onboard");
  expect(href.searchParams.get("students")).toBe("13");
  expect(href.searchParams.get("skills")).toBe(
    "Distributing a negative sign|Finding the error in a worked solution",
  );
  for (const name of STUDENT_NAMES) expect(href.toString()).not.toContain(name.split(" ")[0]);

  await handoff.getByRole("button", { name: "Copy names" }).click();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied.split("\n")).toHaveLength(13);
  await handoff.getByRole("button", { name: "Not now" }).click();

  // Share: a view-only link, then the page behind it.
  const share = page.getByRole("dialog", { name: "Share this report" });
  await openDialog(page.getByRole("button", { name: "Get a share link" }), share);
  const link = share.getByRole("textbox", { name: "Share link" });
  await expect(link).toHaveValue(/\/share\/demo/);
  await page.goto(await link.inputValue());
  await expect(page.getByRole("heading", { name: "Solving Linear Equations" })).toBeVisible();
});

test("the shared report hides every student name and pitches Goblins", async ({ page }) => {
  await page.goto("/share/demo");
  await expect(page.getByText("Shared by Ms. Rivera")).toBeVisible();
  await expect(page.locator("#problem-p7")).toContainText("still turned −(5 − 9y) into −5 − 9y");

  const html = await page.content();
  for (const name of STUDENT_NAMES) expect(html).not.toContain(name);

  const teachers = page.getByRole("link", { name: "Try Goblins free" });
  await expect(teachers).toHaveAttribute(
    "href",
    /app\.goblinsapp\.com\/onboard.*utm_campaign=teacher/,
  );
  const leaders = page.getByRole("link", { name: "Talk to the Goblins team" });
  await expect(leaders).toHaveAttribute("href", /goblins\.com\/.*utm_campaign=goblins-max/);
});

test("a class that did well gets extension practice instead", async ({ page }) => {
  await page.goto("/report/demo?case=did-well");
  await expect(page.getByTestId("practice-cta")).toContainText(
    "Stretch all 28 students with extension practice in Goblins",
  );
  await expect(page.getByRole("region", { name: "Where students struggled" })).toHaveCount(0);
});

test.describe("on a phone", () => {
  const { defaultBrowserType: _, ...phone } = devices["Pixel 7"];
  test.use(phone);

  for (const path of ["/report/demo", "/share/demo"]) {
    test(`${path} fits the screen`, async ({ page }) => {
      await page.goto(path);
      await expect(page.getByRole("heading", { name: "Solving Linear Equations" })).toBeVisible();
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
    });
  }
});
