import { type BrowserContextOptions, test as base, devices, type Page } from "@playwright/test";

// A classroom is several people on separate devices in one test: the teacher's
// laptop, the projector window, and any number of student phones. Each one gets
// its own browser context, so cookies and storage are never shared, as on real
// devices.
export type Classroom = {
  readonly teacher: Page;
  readonly projector: Page;
  /** Opens `count` new student devices. Call again for late joiners. */
  readonly students: (count: number) => Promise<ReadonlyArray<Page>>;
};

const laptop = devices["Desktop Chrome"];
const phone = devices["Pixel 7"];

export const test = base.extend<{ classroom: Classroom }>({
  classroom: async ({ browser, baseURL, extraHTTPHeaders }, use) => {
    const shared: BrowserContextOptions = {
      ...(baseURL === undefined ? {} : { baseURL }),
      ...(extraHTTPHeaders === undefined ? {} : { extraHTTPHeaders }),
    };
    const teacherContext = await browser.newContext({ ...laptop, ...shared });
    const projectorContext = await browser.newContext({ ...laptop, ...shared });
    const contexts = [teacherContext, projectorContext];

    const students = async (count: number) => {
      const pages: Array<Page> = [];
      for (let i = 0; i < count; i++) {
        const context = await browser.newContext({ ...phone, ...shared });
        contexts.push(context);
        pages.push(await context.newPage());
      }
      return pages;
    };

    await use({
      teacher: await teacherContext.newPage(),
      projector: await projectorContext.newPage(),
      students,
    });

    await Promise.all(contexts.map((context) => context.close()));
  },
});

export { expect } from "@playwright/test";
