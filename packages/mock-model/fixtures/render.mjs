// Renders each <section> of whiteboards.html to fixtures/<id>.png.
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const dir = fileURLToPath(new URL(".", import.meta.url));
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 800, height: 480 }, deviceScaleFactor: 1 });
await page.goto(new URL("whiteboards.html", import.meta.url).href);
for (const section of await page.locator("section").all()) {
  const id = await section.getAttribute("id");
  await section.screenshot({ path: `${dir}${id}.png` });
}
await browser.close();
