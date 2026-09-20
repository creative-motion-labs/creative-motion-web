/**
 * Run: npx tsx --test app/lib/patient-portal/resolve-patient-home-display.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import type { PatientPlanData, PatientSession } from "@/app/api/patient/plan/route";
import { STROKE_UPPER_LIMB_RECOVERY_FOUNDATION_SESSION_1 } from "@/app/lib/rehab-programs/stroke-upper-limb-recovery-foundation";
import {
  resolvePatientHomeProgramTitle,
  resolvePatientHomeRehabFocus,
  resolvePatientHomeSessionDisplay,
  shouldShowPatientHomeExerciseCount,
} from "./resolve-patient-home-display";

function basePlan(overrides: Partial<PatientPlanData> = {}): PatientPlanData {
  return {
    patientName: "Test Patient",
    patientLanguage: "en",
    diagnosis: null,
    planId: "plan-1",
    planTitle: "Upper Limb Recovery Foundation",
    programName: "Upper Limb Recovery Foundation",
    phaseName: "Phase 1",
    phaseGoal: "",
    patientRehabFocus: "Build shoulder confidence for daily reaching.",
    patientFriendlyGoal: null,
    programTemplateId: null,
    sessionsPerWeek: 3,
    totalWeeks: 4,
    clinicianNotes: "",
    assignedBy: "Dr. Smith",
    assignedAt: "2026-08-01T00:00:00.000Z",
    sessions: [],
    lifetimeSummary: {
      completedSessions: 0,
      programsAssigned: 1,
      movementCaptures: 0,
      lastActivityAt: null,
    },
    ...overrides,
  };
}

function baseSession(overrides: Partial<PatientSession> = {}): PatientSession {
  return {
    id: "session-1",
    sessionNumber: 1,
    title: "Session 1 — Activation and Functional Reaching",
    exercises: [],
    status: "today",
    prescribedSide: null,
    catalogSession: STROKE_UPPER_LIMB_RECOVERY_FOUNDATION_SESSION_1,
    ...overrides,
  };
}

describe("resolvePatientHomeProgramTitle", () => {
  it("returns English plan title unchanged", () => {
    const title = resolvePatientHomeProgramTitle(basePlan(), "en");
    assert.equal(title, "Upper Limb Recovery Foundation");
  });

  it("returns Arabic program title for catalog-backed plans", () => {
    const title = resolvePatientHomeProgramTitle(
      basePlan({
        sessions: [baseSession()],
      }),
      "ar",
    );
    assert.equal(title, "أساسيات تعافي الطرف العلوي");
    assert.ok(!title.includes("Upper Limb"));
  });

  it("localizes generic rehab focus when Arabic UI is active", () => {
    const title = resolvePatientHomeProgramTitle(
      basePlan({
        planTitle: "Rehabilitation Plan",
        patientRehabFocus:
          "Follow your plan exercises to safely return to your daily activities.",
      }),
      "ar",
    );
    assert.equal(
      title,
      "اتبع تمارين خطتك للعودة تدريجياً إلى نشاطك اليومي بأمان.",
    );
    assert.ok(!title.includes("Follow your plan"));
  });
});

describe("resolvePatientHomeRehabFocus", () => {
  it("returns Arabic generic focus when portal language is Arabic", () => {
    const focus = resolvePatientHomeRehabFocus(
      basePlan({
        patientRehabFocus:
          "Follow your plan exercises to safely return to your daily activities.",
      }),
      "ar",
    );
    assert.equal(
      focus,
      "اتبع تمارين خطتك للعودة تدريجياً إلى نشاطك اليومي بأمان.",
    );
  });
});

describe("resolvePatientHomeSessionDisplay", () => {
  it("localizes catalog session title and goal for Arabic", () => {
    const display = resolvePatientHomeSessionDisplay(
      baseSession(),
      basePlan({ sessions: [baseSession()] }),
      "ar",
    );
    assert.ok(display.title.includes("الجلسة 1"));
    assert.ok(display.context?.includes("التنشيط"));
    assert.equal(display.durationLabel, "10–15 دقيقة");
    assert.ok(!display.title.includes("Activation"));
  });

  it("formats generic session titles with localized session number", () => {
    const display = resolvePatientHomeSessionDisplay(
      baseSession({
        catalogSession: null,
        title: "Strength and balance",
      }),
      basePlan(),
      "ar",
    );
    assert.match(display.title, /^الجلسة 1 —/);
  });

  it("uses Arabic rehab focus for session context when UI language is Arabic", () => {
    const display = resolvePatientHomeSessionDisplay(
      baseSession({
        catalogSession: null,
        title: "Strength and balance",
      }),
      basePlan({
        patientRehabFocus:
          "Follow your plan exercises to safely return to your daily activities.",
      }),
      "ar",
    );
    assert.equal(
      display.context,
      "اتبع تمارين خطتك للعودة تدريجياً إلى نشاطك اليومي بأمان.",
    );
    assert.ok(!display.context?.includes("Follow your plan"));
  });
});

describe("shouldShowPatientHomeExerciseCount", () => {
  it("hides exercise count for catalog-provenance sessions", () => {
    assert.equal(shouldShowPatientHomeExerciseCount(baseSession()), false);
  });

  it("shows exercise count for legacy sessions", () => {
    assert.equal(
      shouldShowPatientHomeExerciseCount(baseSession({ catalogSession: null })),
      true,
    );
  });
});

describe("patient home next session card — metadata wiring", () => {
  const homeSource = readFileSync(
    join(process.cwd(), "app/components/patient/workspace/PatientWorkspaceHome.tsx"),
    "utf8",
  );
  const nextSessionBlock = homeSource.slice(
    homeSource.indexOf("function NextSessionCard"),
    homeSource.indexOf("function WeeklyActivityStrip"),
  );

  it("does not render a decorative session icon placeholder in NextSessionCard", () => {
    assert.doesNotMatch(
      nextSessionBlock,
      /flex h-\d+ w-\d+ shrink-0 items-center justify-center rounded-full/,
    );
    assert.doesNotMatch(nextSessionBlock, /<circle[\s/>]/);
  });

  it("omits catalog exercise-count metadata from the home card", () => {
    assert.match(homeSource, /shouldShowPatientHomeExerciseCount\(preview\.nextSession\)/);
    assert.match(
      nextSessionBlock,
      /\{exerciseCountLabel \? <span>\{exerciseCountLabel\}<\/span> : null\}/,
    );
  });
});

describe("patient home title duplication check (report-only)", () => {
  it("catalog recovery uses distinct program and session titles in EN and AR", () => {
    const plan = basePlan({ sessions: [baseSession()] });
    const session = baseSession();

    const programEn = resolvePatientHomeProgramTitle(plan, "en");
    const sessionEn = resolvePatientHomeSessionDisplay(session, plan, "en").title;
    const programAr = resolvePatientHomeProgramTitle(plan, "ar");
    const sessionAr = resolvePatientHomeSessionDisplay(session, plan, "ar").title;

    assert.equal(programEn, "Upper Limb Recovery Foundation");
    assert.equal(sessionEn, "Session 1 — Activation and Functional Reaching");
    assert.equal(programAr, "أساسيات تعافي الطرف العلوي");
    assert.equal(sessionAr, "الجلسة 1 — التنشيط والوصول الوظيفي");

    assert.notEqual(programEn.toLowerCase(), sessionEn.toLowerCase());
    assert.notEqual(programAr, sessionAr);
  });
});
