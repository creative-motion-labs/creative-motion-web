import { test, expect, type Page, type Request } from "@playwright/test";
import { installDevBypassCookie } from "./patient-profile-workspace.mocks";
import { installPr313LifecycleMocks, type Pr313LifecycleMocks } from "./pr313-lifecycle.mocks";
import { PR313_TOKEN_A } from "../app/qa/pr313/nav-assessment/page";
import { PR313_ULMS_A } from "../app/qa/pr313/nav-ulms/page";
import { PR313_CAPTURE_PATIENT_A } from "../app/qa/pr313/nav-capture/page";
import { VOICE_UI_LABELS } from "../app/components/patient/voice-ui-labels";

const HYDRATION_WARNING_PATTERN = /hydrat|didn't match|did not match/i;
const VOICE_PRIVACY_NOTE = VOICE_UI_LABELS.privacyNote.en;

function collectHydrationWarnings(page: Page): string[] {
  const messages: string[] = [];
  page.on("console", (msg) => {
    const text = msg.text();
    if (HYDRATION_WARNING_PATTERN.test(text)) {
      messages.push(text);
    }
  });
  return messages;
}

function isApiRequestFor(path: string) {
  return (request: Request) => new URL(request.url()).pathname === path;
}

/** Resolves once the browser has finished or failed (e.g. aborted) this request. */
function trackRequestSettled(page: Page, request: Request): Promise<"finished" | "failed"> {
  return new Promise((resolve) => {
    const onFinished = (settled: Request) => {
      if (settled !== request) return;
      cleanup();
      resolve("finished");
    };
    const onFailed = (settled: Request) => {
      if (settled !== request) return;
      cleanup();
      resolve("failed");
    };
    const cleanup = () => {
      page.off("requestfinished", onFinished);
      page.off("requestfailed", onFailed);
    };
    page.on("requestfinished", onFinished);
    page.on("requestfailed", onFailed);
  });
}

/** Let pending React updates from a just-settled response commit before asserting. */
async function flushRender(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
}

test.describe("PR #313 lifecycle verification", () => {
  let mocks: Pr313LifecycleMocks;

  test.beforeEach(async ({ page, baseURL }) => {
    mocks = await installPr313LifecycleMocks(page);
    await installDevBypassCookie(page, baseURL ?? "http://127.0.0.1:3013");
  });

  test("questionnaire client nav ignores token A response that lands after token B", async ({ page }) => {
    await page.goto("/qa/pr313/nav-assessment");

    const requestA = page.waitForRequest(isApiRequestFor(`/api/remote-assessments/${PR313_TOKEN_A}`));
    await page.getByTestId("nav-token-a").click();
    const settledA = trackRequestSettled(page, await requestA);
    await expect(page.getByText("Verifying assessment link")).toBeVisible();

    await page.getByTestId("float-token-b").click();
    await expect(page.getByText("Before you begin")).toBeVisible();

    mocks.releaseSlow("questionnaire");
    expect(await settledA).toBe("finished");
    // getRemoteAssessment persists each response it parses; A present => A was fully processed.
    await expect
      .poll(() =>
        page.evaluate((id) => Object.keys(localStorage).some((key) => key.includes(id)), PR313_TOKEN_A),
      )
      .toBe(true);
    await flushRender(page);

    await page.getByRole("button", { name: "I understand — begin assessment" }).click();
    await expect(page.getByRole("heading", { name: "Daily Activities" })).toBeVisible();
    await expect(page.getByText("Pain & Symptoms")).toHaveCount(0);
  });

  test("remote ULMS client nav keeps patient B after stale A settles", async ({ page }) => {
    await page.goto("/qa/pr313/nav-ulms");

    const requestA = page.waitForRequest(isApiRequestFor(`/api/patient/assessment/${PR313_ULMS_A}`));
    await page.getByTestId("nav-ulms-a").click();
    const settledA = trackRequestSettled(page, await requestA);
    await expect(page.getByText("Loading assessment")).toBeVisible();

    await page.getByTestId("float-ulms-b").click();
    await expect(page.getByText("Hello, Beta")).toBeVisible();

    mocks.releaseSlow("ulms");
    // The effect cleanup aborts A when the route identity changes.
    expect(await settledA).toBe("failed");
    await flushRender(page);

    await expect(page.getByText("Hello, Beta")).toBeVisible();
    await expect(page.getByText("Hello, Alpha")).toHaveCount(0);
  });

  test("clinician capture client nav keeps patient B after stale A settles", async ({ page }) => {
    await page.goto("/qa/pr313/nav-capture");

    const requestA = page.waitForRequest(isApiRequestFor(`/api/patients/${PR313_CAPTURE_PATIENT_A}`));
    await page.getByTestId("nav-capture-a").click();
    const settledA = trackRequestSettled(page, await requestA);
    await expect(page.getByText("Loading patient context")).toBeVisible();

    await page.getByTestId("float-capture-b").click();
    await expect(page.getByText("Patient: Capture Beta")).toBeVisible();

    mocks.releaseSlow("capture");
    // The effect cleanup aborts A when the route identity changes.
    expect(await settledA).toBe("failed");
    await flushRender(page);

    await expect(page.getByText("Patient: Capture Beta")).toBeVisible();
    await expect(page.getByText("Patient: Capture Alpha")).toHaveCount(0);
  });

  test("voice consent accepted in the form persists across reload without hydration warnings", async ({ page }) => {
    const hydration = collectHydrationWarnings(page);
    const beginAssessment = page.getByRole("button", { name: "I understand — begin assessment" });
    const voiceBannerHeading = page.getByRole("heading", { name: "Voice input" });
    const privacyNote = page.getByText(VOICE_PRIVACY_NOTE);

    await page.goto("/qa/pr313/nav-assessment");
    await page.getByTestId("nav-token-b").click();
    await beginAssessment.click();
    await expect(page.getByRole("heading", { name: "Daily Activities" })).toBeVisible();

    // No consent yet: recording asks for consent and field privacy notes are hidden.
    await expect(privacyNote).toHaveCount(0);
    await page.getByRole("button", { name: "Start voice input" }).first().click();
    await expect(voiceBannerHeading).toBeVisible();
    await page.getByRole("button", { name: "I understand — enable voice" }).click();
    await expect(voiceBannerHeading).toHaveCount(0);
    await expect(privacyNote.first()).toBeVisible();

    await page.reload();
    await beginAssessment.click();
    await expect(page.getByRole("heading", { name: "Daily Activities" })).toBeVisible();
    await expect(privacyNote.first()).toBeVisible();
    await expect(voiceBannerHeading).toHaveCount(0);
    expect(await page.evaluate(() => sessionStorage.getItem("rasq_voice_consent"))).toBe("1");

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
