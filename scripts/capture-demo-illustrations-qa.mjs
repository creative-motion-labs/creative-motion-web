/**
 * QA captures for PR #310 — welcome + mobile active PNF guide.
 * Usage: npm run dev (port 3000), then node scripts/capture-demo-illustrations-qa.mjs
 */
import { chromium, devices } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const BASE = process.env.DEMO_BASE_URL ?? "http://127.0.0.1:3000";
const OUT = join(process.cwd(), "public", "images", "rasq-demo", "qa");

async function waitForIntro(page) {
  await page.goto(`${BASE}/demo`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.getByRole("heading", { name: /interactive movement demonstration/i }).waitFor({
    timeout: 60_000,
  });
  await page.locator('img[src*="reach-to-right-seated-guide"]').first().waitFor({ state: "visible" });
  await page.locator('img[src*="pnf-diagonal-1-demonstration-guide"]').first().waitFor({
    state: "visible",
  });
}

async function captureIntro(page, fileName) {
  await waitForIntro(page);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: join(OUT, fileName), fullPage: true });
}

async function captureActivePnfGuide(page, fileName) {
  await waitForIntro(page);
  await page.getByRole("button", { name: "Start demo" }).click();
  await page.getByRole("button", { name: /Continue without camera/i }).waitFor({
    state: "visible",
    timeout: 120_000,
  });
  await page.getByRole("button", { name: /Continue without camera/i }).click();
  await page
    .locator('img[src*="pnf-diagonal-1-demonstration-guide"]')
    .first()
    .waitFor({ state: "visible", timeout: 420_000 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: join(OUT, fileName), fullPage: true });
}

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ headless: true });

const desktop = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await captureIntro(desktop, "desktop-intro.png");
await desktop.close();

const mobileIntro = await browser.newPage({ ...devices["Pixel 5"] });
await captureIntro(mobileIntro, "mobile-intro.png");
await mobileIntro.close();

const mobileActive = await browser.newPage({ ...devices["Pixel 5"] });
await captureActivePnfGuide(mobileActive, "mobile-active-pnf-guide.png");
await mobileActive.close();

await browser.close();

const report = {
  baseUrl: BASE,
  outputs: [
    "desktop-intro.png",
    "mobile-intro.png",
    "mobile-active-pnf-guide.png",
  ],
};
writeFileSync(join(OUT, "capture-report.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
