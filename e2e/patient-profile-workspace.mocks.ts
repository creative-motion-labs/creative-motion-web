import type { Page, Route } from "@playwright/test";
import { buildGeneralMskPayload } from "../app/lib/assessment-payload";
import { createEmptyGeneralAssessmentDraft } from "../app/lib/general-assessment/defaults";

/** Synthetic ids only — not a real patient record. */
export const SYNTHETIC_PATIENT_ID = "e2e00000-0000-4000-a000-000000000099";
export const SYNTHETIC_PLAN_ID = "e2e00000-0000-4000-a000-000000000010";
export const SYNTHETIC_ASSESSMENT_ID = "e2e00000-0000-4000-a000-000000000020";
export const SYNTHETIC_PROVIDER_ID = "e2e00000-0000-4000-a000-000000000088";

const NOW = "2026-01-15T10:00:00.000Z";

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

function buildSyntheticPatient() {
  return {
    id: SYNTHETIC_PATIENT_ID,
    provider_id: SYNTHETIC_PROVIDER_ID,
    full_name: "Synthetic E2E Patient",
    phone: "+966500000001",
    age: 34,
    gender: "F",
    sport: null,
    diagnosis: "Synthetic MSK profile (E2E mocks only)",
    status: "Active",
    file_number: "E2E-PROFILE-099",
    created_at: NOW,
    updated_at: NOW,
  };
}

function buildAssessmentStructuredData() {
  const draft = createEmptyGeneralAssessmentDraft();
  draft.subjective.chiefComplaint = "Synthetic chief complaint for E2E.";
  draft.subjective.painLocation = "Right knee";
  draft.subjective.nprs = "4";
  draft.subjective.aggravating = "Stairs";
  draft.subjective.goals = "Return to walking";
  return buildGeneralMskPayload(draft, "en");
}

function buildAssessmentDetail() {
  return {
    id: SYNTHETIC_ASSESSMENT_ID,
    patient_id: SYNTHETIC_PATIENT_ID,
    provider_id: SYNTHETIC_PROVIDER_ID,
    type: "general_msk",
    notes: null,
    status: "completed",
    created_at: NOW,
    updated_at: NOW,
    structured_data: buildAssessmentStructuredData(),
  };
}

function buildPlanRow() {
  return {
    id: SYNTHETIC_PLAN_ID,
    patient_id: SYNTHETIC_PATIENT_ID,
    provider_id: SYNTHETIC_PROVIDER_ID,
    title: "Synthetic E2E plan",
    status: "active",
    created_at: NOW,
    updated_at: NOW,
    clinician_note: "E2E clinician note",
    structured_data: {
      programId: "e2e-program",
      programName: "Synthetic rehab program",
      phase: "phase-1",
      phaseName: "Phase 1",
      phaseGoal: "Restore baseline mobility for therapist review.",
      sessionsPerWeek: 3,
      assignedBy: "E2E",
    },
    patient_token: "e2e-synthetic-portal-token",
    sessions: [
      {
        id: "e2e-session-1",
        plan_id: SYNTHETIC_PLAN_ID,
        session_number: 1,
        title: "Session 1",
        status: "completed",
        completed_at: NOW,
        scheduled_at: NOW,
        exercises: [],
      },
      {
        id: "e2e-session-2",
        plan_id: SYNTHETIC_PLAN_ID,
        session_number: 2,
        title: "Session 2",
        status: "upcoming",
        completed_at: null,
        scheduled_at: null,
        exercises: [],
      },
    ],
  };
}

function buildPlanProgress() {
  return {
    planId: SYNTHETIC_PLAN_ID,
    sessionsCompleted: 1,
    totalSessions: 2,
    progressPct: 50,
    latestEffortScore: 7,
    latestPainResponse: "Mild",
    lastCompletedAt: NOW,
    needsReview: false,
    reviewAcknowledged: true,
    reviewedAt: NOW,
    latestPatientNote: null,
    latestSessionLogId: null,
    safetyConcernReported: false,
    clinicalAction: null,
  };
}

function buildCvMetric() {
  return {
    id: "e2e-cv-metric-1",
    patientId: SYNTHETIC_PATIENT_ID,
    planSessionId: "e2e-session-1",
    exerciseId: "sit-to-stand",
    source: "patient_session",
    repCount: 8,
    sessionDurationS: 42,
    trackingQuality: "good",
    movementDetected: true,
    prototypeVersion: "0.1",
    recordedAt: NOW,
  };
}

export async function installPatientProfileApiMocks(page: Page): Promise<void> {
  const assessmentDetail = buildAssessmentDetail();

  await page.route("**/api/**", async (route) => {
    const req = route.request();
    if (req.method() !== "GET") {
      return route.fulfill({ status: 405, body: "Method not allowed in E2E mocks" });
    }

    const url = new URL(req.url());
    const { pathname, searchParams } = url;

    if (pathname === `/api/patients/${SYNTHETIC_PATIENT_ID}`) {
      return json(route, buildSyntheticPatient());
    }

    if (pathname === "/api/plans" && searchParams.get("patientId") === SYNTHETIC_PATIENT_ID) {
      return json(route, [buildPlanRow()]);
    }

    if (pathname === "/api/clinician/patient-progress") {
      if (searchParams.get("patientId") !== SYNTHETIC_PATIENT_ID) {
        return json(route, { error: "not found" }, 404);
      }
      if (searchParams.get("timelineOnly") === "1") {
        return json(route, { events: [] });
      }
      return json(route, buildPlanProgress());
    }

    if (pathname === "/api/assessments" && searchParams.get("patientId") === SYNTHETIC_PATIENT_ID) {
      return json(route, [
        {
          id: assessmentDetail.id,
          patient_id: SYNTHETIC_PATIENT_ID,
          provider_id: SYNTHETIC_PROVIDER_ID,
          type: assessmentDetail.type,
          notes: null,
          status: "completed",
          created_at: NOW,
          updated_at: NOW,
        },
      ]);
    }

    if (pathname === `/api/assessments/${SYNTHETIC_ASSESSMENT_ID}`) {
      return json(route, assessmentDetail);
    }

    if (pathname === "/api/cv/session-metrics") {
      return json(route, { metrics: [buildCvMetric()], demoMode: false, demoNotice: null });
    }

    if (pathname === "/api/clinician/objective-results") {
      return json(route, { series: [], latestEvent: null });
    }

    if (pathname === "/api/remote-assessments") {
      return json(route, []);
    }

    if (pathname === "/api/clinician/ai-session-summary") {
      return json(route, { summary: null });
    }

    return json(route, []);
  });
}

export async function installDevBypassCookie(page: Page, baseURL: string): Promise<void> {
  const host = new URL(baseURL).hostname;
  await page.context().addCookies([
    {
      name: "cm_token",
      value: "dev_bypass_token_e2e_playwright",
      domain: host,
      path: "/",
    },
  ]);
}
