import type { Page } from "@playwright/test";
import { expect, test } from "../fixtures";

// Setup by chat, from a template, with the mock model: no model calls.
// Covers the PRD's "Assignment setup" flow up to the sign-in that launch asks for.

const problem = (page: Page, label: string) =>
  page.getByRole("article", { name: `Problem ${label}`, exact: true });

/** Waits until React has hydrated the screen, so clicks are not lost. */
const ready = (page: Page) =>
  expect(page.locator(".setup-screen[data-hydrated]")).toBeVisible({ timeout: 20_000 });

const ask = async (page: Page, message: string) => {
  const replies = page.locator(".setup-chat-message[data-role=assistant]:not([data-pending])");
  const before = await replies.count();
  await page.getByRole("textbox", { name: "Message" }).fill(message);
  await page.getByRole("button", { name: "Send" }).click();
  await expect(replies).toHaveCount(before + 1, { timeout: 15_000 });
  return replies.last();
};

test("teacher sets up a template by chat and inline edits, and it persists", async ({ page }) => {
  await page.goto("/setup/template/linear-relationships");
  await expect(page).toHaveURL(/\/setup\/[0-9a-f-]{36}$/);
  await ready(page);

  // What the grader knows: text, the diagram description, the rubric, and dependency links.
  await expect(page.getByRole("textbox", { name: "Assignment name" })).toHaveValue(
    "Linear Relationships in Context",
  );
  await expect(problem(page, "2a")).toContainText("The grader reads this instead of the picture");
  await expect(problem(page, "3b")).toContainText("Uses the answer to 3a");
  await expect(problem(page, "4")).toContainText("2 pts");

  // Chat: the three requests the PRD names.
  await expect(await ask(page, "Make problem 4 worth 5 points")).toContainText(
    "Problem 4 is now worth 5 points",
  );
  await expect(problem(page, "4")).toContainText("5 pts");

  await expect(await ask(page, "accept unsimplified fractions")).toContainText(
    "Accept unsimplified fractions.",
  );
  await expect(problem(page, "1")).toContainText("Accept unsimplified fractions.");

  await expect(await ask(page, "you missed problem 8")).toContainText("I added problem 8");
  const added = problem(page, "8");
  await expect(added).toBeVisible();
  // The new card opens ready to type.
  const text = added.getByRole("textbox", { name: "Problem 8 text" });
  await expect(text).toBeFocused();
  await text.fill("A plant is 12 cm tall and grows 3 cm a week. How tall is it after 6 weeks?");
  await text.press("ControlOrMeta+Enter");
  await added.getByRole("button", { name: "Edit problem 8 answer key" }).click();
  await added.getByRole("textbox", { name: "Problem 8 answer key" }).fill("30 cm");
  await added.getByRole("textbox", { name: "Problem 8 answer key" }).blur();
  await expect(page.getByText("Saved")).toBeVisible();

  // Inline edit: the name.
  const name = page.getByRole("textbox", { name: "Assignment name" });
  await name.fill("Period 3 · Linear relationships quiz");
  await name.press("Enter");
  await expect(page.getByText("Saved")).toBeVisible();

  // Everything survives a reload.
  await page.reload();
  await ready(page);
  await expect(name).toHaveValue("Period 3 · Linear relationships quiz");
  await expect(problem(page, "4")).toContainText("5 pts");
  await expect(problem(page, "8")).toContainText("How tall is it after 6 weeks?");
  await expect(problem(page, "8")).toContainText("30 cm");
  await expect(
    page.locator(".setup-chat-message[data-role=teacher]:not([data-pending])"),
  ).toHaveCount(3);

  // Launch asks for Google sign-in, and only here.
  await page.getByRole("button", { name: "Launch", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("Period 3 · Linear relationships quiz");
  await expect(page.getByRole("button", { name: "Sign in with Google to launch" })).toBeVisible();
});

test("a part asked about by its problem number gets a question back, not a guess", async ({
  page,
}) => {
  await page.goto("/setup/template/linear-relationships");
  await ready(page);
  await expect(await ask(page, "make problem 3 worth 4 points")).toContainText(
    "Which part should be worth 4 points?",
  );
});

test("another browser cannot open the draft", async ({ page, browser }) => {
  await page.goto("/setup/template/angle-relationships");
  await ready(page);
  const stranger = await browser.newPage();
  await stranger.goto(page.url());
  await expect(stranger.getByText("We can't find that assignment")).toBeVisible();
  await stranger.close();
});
