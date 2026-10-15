/**
 * Concurrent requests must not see each other's identity (the request-context bug). Needs a
 * local stack in AUTH_MODE=local with two live sessions seeded: join code 111111 owned by Clerk id
 * `teacher_a`, 222222 by `teacher_b` (session ids in E2E_ISOLATION_SESSIONS="<a>,<b>"). Skipped
 * otherwise, since previews have neither local auth nor seeded data.
 */
import { expect, test } from "@playwright/test";

const sessions = process.env.E2E_ISOLATION_SESSIONS?.split(",");

test.skip(sessions === undefined, "needs a seeded local stack");

test("six students joining at once each get their own cookie", async ({ browser, baseURL }) => {
  const contexts = await Promise.all(Array.from({ length: 6 }, () => browser.newContext()));
  const results = await Promise.all(
    contexts.map(async (context, i) => {
      const page = await context.newPage();
      await page.goto(`${baseURL}/join?code=111111`);
      await page.getByLabel("Your name").fill(`Kid ${i} Z`);
      await page.getByRole("button", { name: "Join" }).click();
      await page.waitForURL(/\/play\//);
      const cookies = await context.cookies();
      return cookies.filter((c) => c.name.startsWith("gb_student_")).map((c) => c.value);
    }),
  );
  for (const cookies of results) expect(cookies).toHaveLength(1);
  // Six different students, not one cookie copied onto several responses.
  expect(new Set(results.flat()).size).toBe(6);
  await Promise.all(contexts.map((c) => c.close()));
});

test("two teachers at once only ever see their own session", async ({ playwright, baseURL }) => {
  const [a, b] = sessions ?? [];
  const teacher = (id: string) =>
    playwright.request.newContext({
      ...(baseURL === undefined ? {} : { baseURL }),
      extraHTTPHeaders: { cookie: `gb_local_teacher=${id}` },
    });
  const [ta, tb] = await Promise.all([teacher("teacher_a"), teacher("teacher_b")]);
  const shape = (ctx: typeof ta, sessionId: string | undefined) =>
    ctx.get(`/api/shape?view=session&sessionId=${sessionId}&offset=-1`).then((r) => r.status());
  const rounds = await Promise.all(
    Array.from({ length: 20 }, () =>
      Promise.all([shape(ta, a), shape(tb, b), shape(ta, b), shape(tb, a)]),
    ),
  );
  for (const [ownA, ownB, crossA, crossB] of rounds) {
    expect([ownA, ownB]).toEqual([200, 200]);
    expect([crossA, crossB]).toEqual([403, 403]);
  }
});
