import { test, expect, type Page } from "@playwright/test";
import {
  SYNTHETIC_PATIENT_ID,
  installDevBypassCookie,
  installPatientProfileApiMocks,
} from "./patient-profile-workspace.mocks";

const PROFILE_PATH = `/clinician/patients/${SYNTHETIC_PATIENT_ID}`;

const SECTION_PANEL_IDS = [
  "patient-profile-section-overview",
  "patient-profile-section-assessments",
  "patient-profile-section-plan",
  "patient-profile-section-progress",
  "patient-profile-section-movement",
  "patient-profile-section-activity",
] as const;

async function openProfile(page: Page, query = "") {
  await page.goto(`${PROFILE_PATH}${query}`, { waitUntil: "networkidle" });
  await expect(page.getByRole("heading", { name: "Synthetic E2E Patient" })).toBeVisible();
}

async function visibleTabpanelCount(page: Page): Promise<number> {
  return page.locator('[role="tabpanel"]').evaluateAll((nodes) =>
    nodes.filter((node) => !(node as HTMLElement).hidden).length,
  );
}

async function expectActivePanel(page: Page, panelId: string) {
  const panel = page.locator(`#${panelId}`);
  await expect(panel).toBeVisible();
  await expect.poll(() => visibleTabpanelCount(page)).toBe(1);
}

test.beforeEach(async ({ page, baseURL }) => {
  await installPatientProfileApiMocks(page);
  await installDevBypassCookie(page, baseURL ?? "http://127.0.0.1:3000");
});

test.describe("Patient profile workspace", () => {
  test("six unique tabpanels; only selected panel visible on Overview", async ({ page }) => {
    await openProfile(page);

    const ids = await page.locator('[role="tabpanel"]').evaluateAll((nodes) =>
      nodes.map((node) => node.id).filter(Boolean),
    );
    expect(ids.sort()).toEqual([...SECTION_PANEL_IDS].sort());
    expect(new Set(ids).size).toBe(6);

    await expectActivePanel(page, "patient-profile-section-overview");
    await expect(page.getByRole("heading", { name: "Remote assessments" })).toBeVisible();

    const tablist = page.getByRole("tablist");
    await expect(tablist.getByRole("link", { name: "Outcomes" })).toHaveCount(0);
    await expect(tablist.getByRole("link", { name: "Results" })).toHaveCount(0);
    const relatedHubs = page.getByLabel("Related clinician hubs");
    await expect(relatedHubs.getByRole("link", { name: "Outcomes", exact: true })).toHaveAttribute(
      "href",
      `/clinician/patients/${SYNTHETIC_PATIENT_ID}/outcomes`,
    );
    await expect(relatedHubs.getByRole("link", { name: "Results", exact: true })).toHaveAttribute(
      "href",
      "/clinician/results",
    );
  });

  test("tab clicks switch sections", async ({ page }) => {
    await openProfile(page);

    await page.getByRole("tab", { name: "Assessment" }).click();
    await expect(page).toHaveURL(/section=assessments/);
    await expectActivePanel(page, "patient-profile-section-assessments");
    await expect(page.getByRole("heading", { name: "Clinical Assessment Summary" })).toBeVisible();

    await page.getByRole("tab", { name: "Movement tracking" }).click();
    await expect(page).toHaveURL(/section=movement/);
    await expectActivePanel(page, "patient-profile-section-movement");
    await expect(page.getByRole("heading", { name: "Movement tracking sessions" })).toBeVisible();
  });

  test("keyboard Home/End and Arrow navigation on tablist", async ({ page }) => {
    await openProfile(page);

    const overviewTab = page.getByRole("tab", { name: "Overview" });
    await overviewTab.focus();
    await page.keyboard.press("End");
    await expect(page.getByRole("tab", { name: "Activity" })).toBeFocused();
    await expect(page.getByRole("tab", { name: "Activity" })).toHaveAttribute(
      "aria-selected",
      "true",
    );

    await page.keyboard.press("Home");
    await expect(overviewTab).toBeFocused();

    await page.keyboard.press("ArrowRight");
    await expect(page.getByRole("tab", { name: "Assessment" })).toBeFocused();
  });

  test("?section= deep link and browser Back/Forward", async ({ page }) => {
    await openProfile(page, "?section=plan");
    await expectActivePanel(page, "patient-profile-section-plan");
    await expect(page.getByRole("heading", { name: "Rehabilitation Plan" })).toBeVisible();

    await page.getByRole("tab", { name: "Progress" }).click();
    await expect(page).toHaveURL(/section=progress/);

    await page.goBack();
    await expect(page).toHaveURL(/section=plan/);
    await expectActivePanel(page, "patient-profile-section-plan");

    await page.goForward();
    await expect(page).toHaveURL(/section=progress/);
    await expectActivePanel(page, "patient-profile-section-progress");
  });

  test("legacy hash maps to ?section= plan", async ({ page }) => {
    await page.goto(`${PROFILE_PATH}#rehabilitation-plan`, { waitUntil: "networkidle" });
    await expect(page).toHaveURL(/section=plan/);
    await expectActivePanel(page, "patient-profile-section-plan");
  });

  test("unsaved edit fields retained when switching sections", async ({ page }) => {
    await openProfile(page);

    await page.getByRole("button", { name: "Edit Patient" }).click();
    await page.getByLabel("Full Name").fill("Synthetic E2E Patient — unsaved edit");

    await page.getByRole("tab", { name: "Treatment plan" }).click();
    await expectActivePanel(page, "patient-profile-section-plan");

    await page.getByRole("tab", { name: "Overview" }).click();
    await expectActivePanel(page, "patient-profile-section-overview");
    await expect(page.getByLabel("Full Name")).toHaveValue(
      "Synthetic E2E Patient — unsaved edit",
    );
  });

  test("movement tab shows populated CV session list", async ({ page }) => {
    await openProfile(page, "?section=movement");
    await expectActivePanel(page, "patient-profile-section-movement");
    await expect(page.getByRole("heading", { name: "Movement tracking sessions" })).toBeVisible();
    await expect(page.getByRole("button", { name: "View details" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Open Outcomes hub →" })).toHaveAttribute(
      "href",
      `/clinician/patients/${SYNTHETIC_PATIENT_ID}/outcomes`,
    );
  });

  test("View details expands clinical and plan content", async ({ page }) => {
    await openProfile(page, "?section=assessments");

    const detailsToggle = page
      .getByRole("heading", { name: "Clinical Assessment Summary" })
      .locator("xpath=ancestor::section[1]")
      .getByRole("button", { name: "View details" });
    await detailsToggle.click();
    await expect(page.getByText("Synthetic chief complaint for E2E.")).toBeVisible();

    await page.getByRole("tab", { name: "Treatment plan" }).click();
    await page.getByRole("button", { name: "View details" }).first().click();
    await expect(page.getByText("Session schedule")).toBeVisible();
  });
});

test.describe("Patient profile movement tracking states", () => {
  test("empty CV response shows empty state, not error copy", async ({ page, baseURL }) => {
    await installPatientProfileApiMocks(page, { cvMode: "empty" });
    await installDevBypassCookie(page, baseURL ?? "http://127.0.0.1:3000");
    await openProfile(page, "?section=movement");
    await expect(page.getByText("No saved movement tracking sessions yet.")).toBeVisible();
    await expect(page.getByText("Could not load movement tracking sessions.")).toHaveCount(0);
  });

  test("failed CV response shows error state, not empty copy", async ({ page, baseURL }) => {
    await installPatientProfileApiMocks(page, { cvMode: "error" });
    await installDevBypassCookie(page, baseURL ?? "http://127.0.0.1:3000");
    await openProfile(page, "?section=movement");
    await expect(page.getByText("Could not load movement tracking sessions.")).toBeVisible();
    await expect(page.getByText("No saved movement tracking sessions yet.")).toHaveCount(0);
  });
});
