import { expect, test } from "../fixtures";

// Landing page: the pitch, the four templates, and a wrong file answered in the
// browser with a template suggestion, before anything is uploaded.
test("landing page pitches, lists templates and rejects a wrong file", async ({ classroom }) => {
  const page = classroom.teacher;
  await page.goto("/");
  // The drop zone's handlers attach on hydration; a file set before then is ignored.
  await page.waitForLoadState("networkidle");

  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Grade your next test for you.");
  await expect(page.getByRole("button", { name: "Choose a file" })).toBeVisible();
  await expect(page.locator(".lp-template")).toHaveCount(4);

  await page.locator('input[type="file"]').setInputFiles({
    name: "notes.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("not a worksheet"),
  });
  await expect(page.getByRole("alert")).toHaveText("We can't open that kind of file");
  await expect(page.getByRole("button", { name: "Start from a template" })).toBeVisible();
});
