import { expect, test } from "../fixtures";

// Checks the deploy answers and the classroom fixture opens isolated devices.
// Flow tests (setup, join, submit, dashboard, report) replace this as the app lands.
test("teacher, projector and three students each load the app", async ({ classroom }) => {
  const students = await classroom.students(3);
  const devices = [classroom.teacher, classroom.projector, ...students];

  for (const page of devices) {
    const response = await page.goto("/");
    expect(response?.ok()).toBe(true);
  }

  // A cookie set on one device must not appear on another.
  await classroom.teacher
    .context()
    .addCookies([{ name: "e2e_device", value: "teacher", url: classroom.teacher.url() }]);
  for (const page of [classroom.projector, ...students]) {
    const cookies = await page.context().cookies();
    expect(cookies.find((cookie) => cookie.name === "e2e_device")).toBeUndefined();
  }
});
