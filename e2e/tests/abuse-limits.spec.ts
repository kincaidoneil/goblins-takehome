import { expect, test } from "../fixtures";

// Guessing join codes gets an address locked out for the rest of the minute. Off Vercel the app
// trusts `x-real-ip`, so the test picks a fresh address per run. The student cap and the grading
// cap are covered against Postgres in packages/domain's lifecycle tests.

test("an address that keeps guessing join codes is refused", async ({ request }) => {
  const headers = { "x-real-ip": `e2e-${crypto.randomUUID()}` };
  const attempt = (joinCode: string) =>
    request.post("/api/join", { headers, data: { joinCode, name: "Guess G." } });

  for (let i = 0; i < 20; i++) {
    expect((await attempt("not a code")).status()).toBe(404);
  }
  const refused = await attempt("123456");
  expect(refused.status()).toBe(429);
  expect(await refused.json()).toEqual({ _tag: "RateLimited" });

  // Another address is unaffected.
  const other = await request.post("/api/join", {
    headers: { "x-real-ip": `e2e-${crypto.randomUUID()}` },
    data: { joinCode: "not a code", name: "Guess G." },
  });
  expect(other.status()).toBe(404);
});
