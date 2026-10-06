import { test, expect, type Page } from "@playwright/test";
import { installDevBypassCookie } from "./patient-profile-workspace.mocks";
import { installPr313LifecycleMocks } from "./pr313-lifecycle.mocks";

const EXPECTED_SHA = process.env.PR313_VERIFY_SHA ?? "763617efc022d91b999fa5d95e0080fc3de3aa3d";

function collectHydrationWarnings(page: Page): string[] {
  const messages: string[] = [];
  page.on("console", (msg) => {
    const text = msg.text();
    if (/hydration|did not match/i.test(text)) {
      messages.push(text);
    }
  });
  return messages;
}

test.describe("PR #313 lifecycle verification", () => {
  test.beforeEach(async ({ page, baseURL }) => {
    await installPr313LifecycleMocks(page);
    await installDevBypassCookie(page, baseURL ?? "http://127.0.0.1:3013");
  });

  test("QA hub exposes expected verify SHA", async ({ page }) => {
    await page.goto("/qa/pr313");
    await expect(page.getByTestId("qa-verify-sha")).toContainText(EXPECTED_SHA.slice(0, 7));
  });

  test("questionnaire assessment client nav avoids stale slow response", async ({ page }) => {
    await page.goto("/qa/pr313/nav-assessment");
    await page.getByTestId("nav-token-a").click();
    await expect(page.getByText("Verifying assessment link")).toBeVisible();
    await page.getByTestId("float-token-b").click();
    await expect(page.getByText("Before you begin")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("Verifying assessment link")).toHaveCount(0);
  });

  test("remote ULMS client nav avoids stale patient greeting", async ({ page }) => {
    await page.goto("/qa/pr313/nav-ulms");
    await page.getByTestId("nav-ulms-a").click();
    await expect(page.getByText("Loading assessment")).toBeVisible();
    await page.getByTestId("float-ulms-b").click();
    await expect(page.getByText("Hello, Beta")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("Hello, Alpha")).toHaveCount(0);
  });

  test("clinician capture client nav avoids stale patient name", async ({ page }) => {
    await page.goto("/qa/pr313/nav-capture");
    await page.getByTestId("nav-capture-a").click();
    await expect(page.getByText("Loading patient context")).toBeVisible();
    await page.getByTestId("float-capture-b").click();
    await expect(page.getByText("Patient: Capture Beta")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("Patient: Capture Alpha")).toHaveCount(0);
  });

  test("voice consent persists across reload without hydration warnings", async ({ page }) => {
    const hydration = collectHydrationWarnings(page);

    await page.goto("/assessment/not-a-valid-token");
    await page.evaluate(() => {
      sessionStorage.setItem("rasq_voice_consent", "1");
    });

    await page.goto("/qa/pr313/nav-assessment");
    await page.getByTestId("nav-token-b").click();
    await expect(page.getByText("Before you begin")).toBeVisible({ timeout: 15_000 });
    await page.reload();
    await expect(page.getByText("Before you begin")).toBeVisible({ timeout: 15_000 });

    expect(hydration, hydration.join("\n")).toEqual([]);
  });

  test("rest countdown ticks, resets phase, and disables timer", async ({ page }) => {
    await page.goto("/qa/pr313/rest-countdown");
    await expect(page.getByText("5 seconds")).toBeVisible();
    await page.waitForTimeout(1100);
    await expect(page.getByText("4 seconds")).toBeVisible();
    await page.getByTestId("rest-phase-b").click();
    await expect(page.getByText("5 seconds")).toBeVisible();
    await page.getByTestId("rest-duration-off").click();
    await expect(page.getByText(/\d+ seconds/)).toHaveCount(0);
  });

  test("ready countdown completes once (reduced motion path)", async ({ page }) => {
    await page.goto("/qa/pr313/ready-countdown");
    await page.getByTestId("ready-reduced-motion").click();
    await expect(page.getByTestId("ready-complete-count")).toHaveText("Completions: 1", {
      timeout: 5000,
    });
    await page.waitForTimeout(500);
    await expect(page.getByTestId("ready-complete-count")).toHaveText("Completions: 1");
  });
});
