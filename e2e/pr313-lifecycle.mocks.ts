import type { Page, Route } from "@playwright/test";
import {
  PR313_CAPTURE_PATIENT_A,
  PR313_CAPTURE_PATIENT_B,
} from "../app/qa/pr313/nav-capture/page";
import { PR313_TOKEN_A, PR313_TOKEN_B } from "../app/qa/pr313/nav-assessment/page";
import { PR313_ULMS_A, PR313_ULMS_B } from "../app/qa/pr313/nav-ulms/page";

const EXPIRES = new Date(Date.now() + 7 * 86400000).toISOString();

export type Pr313SlowEndpoint = "questionnaire" | "ulms" | "capture";

export type Pr313LifecycleMocks = {
  /** Let the held "A" response for this endpoint be fulfilled. */
  releaseSlow(endpoint: Pr313SlowEndpoint): void;
};

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

function createGate(): { promise: Promise<void>; release: () => void } {
  let release = () => {};
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

/** Holds the "A" response until the test releases it; the page may abort it first. */
async function heldJson(route: Route, gate: Promise<void>, body: unknown) {
  await gate;
  try {
    await json(route, body);
  } catch {
    /* request already aborted by the page (navigation cleanup) */
  }
}

/**
 * Patient/clinician API mocks for the PR #313 lifecycle E2E.
 * "A" responses are held until `releaseSlow` so tests control ordering explicitly;
 * "B" responses are fulfilled immediately.
 */
export async function installPr313LifecycleMocks(page: Page): Promise<Pr313LifecycleMocks> {
  const gates = {
    questionnaire: createGate(),
    ulms: createGate(),
    capture: createGate(),
  };

  await page.route("**/api/remote-assessments/*", async (route) => {
    const url = new URL(route.request().url());
    const token = decodeURIComponent(url.pathname.split("/").pop() ?? "");

    if (token === PR313_TOKEN_A) {
      return heldJson(route, gates.questionnaire.promise, {
        assessmentType: "general_msk",
        includedSections: ["pain"],
        expiresAt: EXPIRES,
      });
    }
    if (token === PR313_TOKEN_B) {
      return json(route, {
        assessmentType: "general_msk",
        includedSections: ["functional"],
        expiresAt: EXPIRES,
      });
    }
    return json(route, { error: "Invalid or expired link" }, 404);
  });

  await page.route("**/api/patient/assessment/*", async (route) => {
    const url = new URL(route.request().url());
    const token = decodeURIComponent(url.pathname.split("/").pop() ?? "");

    if (token === PR313_ULMS_A) {
      return heldJson(route, gates.ulms.promise, {
        assignmentId: "00000000-0000-4000-a000-0000000000a1",
        prescribedSide: "right",
        patientFirstName: "Alpha",
      });
    }
    if (token === PR313_ULMS_B) {
      return json(route, {
        assignmentId: "00000000-0000-4000-a000-0000000000b2",
        prescribedSide: "left",
        patientFirstName: "Beta",
      });
    }
    return json(route, { error: "Invalid link" }, 404);
  });

  await page.route("**/api/patients/*", async (route) => {
    const url = new URL(route.request().url());
    const patientId = decodeURIComponent(url.pathname.split("/").pop() ?? "");

    if (patientId === PR313_CAPTURE_PATIENT_A) {
      return heldJson(route, gates.capture.promise, {
        id: PR313_CAPTURE_PATIENT_A,
        full_name: "Capture Alpha",
        provider_id: "e2e00000-0000-4000-a000-000000000088",
      });
    }
    if (patientId === PR313_CAPTURE_PATIENT_B) {
      return json(route, {
        id: PR313_CAPTURE_PATIENT_B,
        full_name: "Capture Beta",
        provider_id: "e2e00000-0000-4000-a000-000000000088",
      });
    }
    return json(route, { error: "Not found" }, 404);
  });

  return {
    releaseSlow(endpoint) {
      gates[endpoint].release();
    },
  };
}
