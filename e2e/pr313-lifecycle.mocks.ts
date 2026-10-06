import type { Page, Route } from "@playwright/test";
import {
  PR313_CAPTURE_PATIENT_A,
  PR313_CAPTURE_PATIENT_B,
} from "../app/qa/pr313/nav-capture/page";
import { PR313_TOKEN_A, PR313_TOKEN_B } from "../app/qa/pr313/nav-assessment/page";
import { PR313_ULMS_A, PR313_ULMS_B } from "../app/qa/pr313/nav-ulms/page";

const EXPIRES = new Date(Date.now() + 7 * 86400000).toISOString();

function json(route: Route, body: unknown, status = 200, delayMs = 0) {
  return route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
    ...(delayMs > 0 ? {} : {}),
  });
}

async function delayedJson(route: Route, body: unknown, delayMs: number, status = 200) {
  await new Promise((resolve) => setTimeout(resolve, delayMs));
  return json(route, body, status);
}

export async function installPr313LifecycleMocks(page: Page): Promise<void> {
  await page.route("**/api/remote-assessments/*", async (route) => {
    const url = new URL(route.request().url());
    const token = decodeURIComponent(url.pathname.split("/").pop() ?? "");

    if (token === PR313_TOKEN_A) {
      return delayedJson(
        route,
        {
          assessmentType: "general_msk",
          includedSections: ["pain"],
          expiresAt: EXPIRES,
        },
        2500,
      );
    }
    if (token === PR313_TOKEN_B) {
      return delayedJson(
        route,
        {
          assessmentType: "general_msk",
          includedSections: ["functional"],
          expiresAt: EXPIRES,
        },
        50,
      );
    }
    return json(route, { error: "Invalid or expired link" }, 404);
  });

  await page.route("**/api/patient/assessment/*", async (route) => {
    const url = new URL(route.request().url());
    const token = decodeURIComponent(url.pathname.split("/").pop() ?? "");

    if (token === PR313_ULMS_A) {
      return delayedJson(
        route,
        {
          assignmentId: "00000000-0000-4000-a000-0000000000a1",
          prescribedSide: "right",
          patientFirstName: "Alpha",
        },
        2500,
      );
    }
    if (token === PR313_ULMS_B) {
      return delayedJson(
        route,
        {
          assignmentId: "00000000-0000-4000-a000-0000000000b2",
          prescribedSide: "left",
          patientFirstName: "Beta",
        },
        50,
      );
    }
    return json(route, { error: "Invalid link" }, 404);
  });

  await page.route("**/api/patients/*", async (route) => {
    const url = new URL(route.request().url());
    const patientId = decodeURIComponent(url.pathname.split("/").pop() ?? "");

    if (patientId === PR313_CAPTURE_PATIENT_A) {
      return delayedJson(
        route,
        {
          id: PR313_CAPTURE_PATIENT_A,
          full_name: "Capture Alpha",
          provider_id: "e2e00000-0000-4000-a000-000000000088",
        },
        2500,
      );
    }
    if (patientId === PR313_CAPTURE_PATIENT_B) {
      return delayedJson(
        route,
        {
          id: PR313_CAPTURE_PATIENT_B,
          full_name: "Capture Beta",
          provider_id: "e2e00000-0000-4000-a000-000000000088",
        },
        50,
      );
    }
    return json(route, { error: "Not found" }, 404);
  });
}
