import { expect, test } from "../fixtures";

// A student draws on the real whiteboard and submits; the PNG that leaves the
// device is the agreed 1024 × 768 export. Needs a live session to join:
// E2E_JOIN_CODE names one (locally, the dev seed's 123456 set to live).
const joinCode = process.env.E2E_JOIN_CODE;

/** Width and height from a PNG's IHDR chunk. */
function pngSize(base64: string): { width: number; height: number } {
  const bytes = Buffer.from(base64, "base64");
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

test("a student draws, submits offline, and the outbox holds a 1024 × 768 PNG", async ({
  classroom,
}) => {
  test.skip(joinCode === undefined, "set E2E_JOIN_CODE to a live session's code");
  const [student] = await classroom.students(1);
  if (student === undefined) throw new Error("no student device");

  await student.goto(`/join?code=${joinCode}`);
  // A submit before hydration posts the form natively and reloads the page.
  await student.waitForLoadState("networkidle");
  // A fresh name each run, letters only, so each run is a new student.
  const initial = String.fromCharCode(65 + (Date.now() % 26));
  const first = ["Robin", "Quinn", "Avery", "Rowan", "Sage"][Date.now() % 5] ?? "Robin";
  await student.getByLabel("Your name").fill(`${first} ${initial}.`);
  await student.getByRole("button", { name: "Join", exact: true }).click();
  await student.waitForURL(/\/play\//);
  const sessionId = new URL(student.url()).pathname.split("/").at(-1) ?? "";

  // An empty board can't be submitted.
  const submit = student.getByRole("button", { name: "Submit" });
  await expect(submit).toBeDisabled();
  await expect(student.getByText("Show your work on the board first.")).toBeVisible();

  // Draw a stroke on the canvas with the pointer.
  const board = student.getByRole("img", { name: /Your whiteboard/ });
  const box = await board.boundingBox();
  if (box === null) throw new Error("whiteboard not on screen");
  await student.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.3);
  await student.mouse.down();
  for (let i = 1; i <= 10; i++) {
    await student.mouse.move(box.x + box.width * (0.2 + i * 0.05), box.y + box.height * (0.3 + i * 0.03));
  }
  await student.mouse.up();
  await expect(submit).toBeEnabled();

  // Offline, the submission waits in the device's outbox, where we can read the PNG.
  await student.context().setOffline(true);
  await submit.click();
  await expect(student.getByText("Saved!")).toBeVisible();
  const outbox = await student.evaluate(
    (key) => window.localStorage.getItem(key),
    `goblins:outbox:${sessionId}`,
  );
  const items: Array<{ png: string }> = JSON.parse(outbox ?? "[]");
  expect(items).toHaveLength(1);
  expect(pngSize(items[0]?.png ?? "")).toEqual({ width: 1024, height: 768 });

  // Back online, it sends and the outbox empties.
  await student.context().setOffline(false);
  await expect
    .poll(() =>
      student.evaluate((key) => window.localStorage.getItem(key), `goblins:outbox:${sessionId}`),
    )
    .toBeNull();
});
