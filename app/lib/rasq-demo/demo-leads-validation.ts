import type { RasqDemoMainGoalId } from "./demo-copy";
import { RASQ_DEMO_MAIN_GOAL_OPTIONS } from "./demo-copy";

const MAIN_GOAL_IDS = new Set<RasqDemoMainGoalId>(
  RASQ_DEMO_MAIN_GOAL_OPTIONS.map((option) => option.id),
);

export type RasqDemoLeadSubmitIntent = "share" | "skip";

const ALLOWED_KEYS = new Set([
  "demoSessionId",
  "name",
  "email",
  "phone",
  "mainGoal",
  "consentRasqUpdates",
  "consentPilotStudy",
  "movementSummary",
  "submitIntent",
]);

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type RasqDemoLeadPayload = {
  demoSessionId: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  mainGoal: RasqDemoMainGoalId | null;
  consentRasqUpdates: boolean;
  consentPilotStudy: boolean;
  movementSummary: Record<string, unknown> | null;
};

export type RasqDemoLeadValidationResult =
  | {
      ok: true;
      value: RasqDemoLeadPayload;
      hasContactOrConsent: boolean;
      submitIntent: RasqDemoLeadSubmitIntent;
    }
  | { ok: false; error: string };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function trimOptionalString(value: unknown, maxLen: number): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, maxLen);
}

function parseMovementSummary(value: unknown): RasqDemoLeadPayload["movementSummary"] {
  if (value === undefined || value === null) return null;
  if (!isPlainObject(value)) return null;
  const duration =
    typeof value.sessionDurationSeconds === "number"
      ? value.sessionDurationSeconds
      : value.sessionElapsedSeconds;
  if (typeof duration !== "number" || !Number.isFinite(duration)) {
    return null;
  }
  return {
    sessionDurationSeconds: Math.max(0, Math.round(duration)),
    targetsReached: value.targetsReached ?? null,
    pnfRepetitionsCompleted: value.pnfRepetitionsCompleted ?? null,
    trackingQuality: value.trackingQuality ?? null,
    movementSmoothness: value.movementSmoothness ?? null,
  };
}

export function validateRasqDemoLeadBody(body: unknown): RasqDemoLeadValidationResult {
  if (!isPlainObject(body)) {
    return { ok: false, error: "Invalid request body." };
  }

  for (const key of Object.keys(body)) {
    if (!ALLOWED_KEYS.has(key)) {
      return { ok: false, error: `Unexpected field: ${key}` };
    }
  }

  const demoSessionId = trimOptionalString(body.demoSessionId, 64);
  if (!demoSessionId) {
    return { ok: false, error: "demoSessionId is required." };
  }

  const name = trimOptionalString(body.name, 120);
  const email = trimOptionalString(body.email, 254);
  const phone = trimOptionalString(body.phone, 40);

  if (email && !EMAIL_PATTERN.test(email)) {
    return { ok: false, error: "Email format is invalid." };
  }

  let mainGoal: RasqDemoMainGoalId | null = null;
  if (body.mainGoal !== undefined && body.mainGoal !== null && body.mainGoal !== "") {
    if (typeof body.mainGoal !== "string" || !MAIN_GOAL_IDS.has(body.mainGoal as RasqDemoMainGoalId)) {
      return { ok: false, error: "mainGoal must be sports, mobility, or rehabilitation." };
    }
    mainGoal = body.mainGoal as RasqDemoMainGoalId;
  }

  const consentRasqUpdates = body.consentRasqUpdates === true;
  const consentPilotStudy = body.consentPilotStudy === true;

  const movementSummary = parseMovementSummary(body.movementSummary);

  let submitIntent: RasqDemoLeadSubmitIntent = "share";
  if (body.submitIntent !== undefined && body.submitIntent !== null) {
    if (body.submitIntent !== "share" && body.submitIntent !== "skip") {
      return { ok: false, error: "submitIntent must be share or skip." };
    }
    submitIntent = body.submitIntent;
  }

  const hasContactOrConsent =
    Boolean(name || email || phone || mainGoal || consentRasqUpdates || consentPilotStudy);

  return {
    ok: true,
    value: {
      demoSessionId,
      name,
      email,
      phone,
      mainGoal,
      consentRasqUpdates,
      consentPilotStudy,
      movementSummary,
    },
    hasContactOrConsent,
    submitIntent,
  };
}

const EMAIL_PATTERN_EXPORT = EMAIL_PATTERN;

export function isValidRasqDemoLeadEmail(email: string | null): boolean {
  return Boolean(email && EMAIL_PATTERN_EXPORT.test(email));
}

/** Client-side check before POST /api/public/rasq-demo/leads (Share details). */
export function validateRasqDemoLeadShareFormFields(input: {
  name: string;
  email: string;
  phone: string;
  mainGoal: RasqDemoMainGoalId | "";
  consentRasqUpdates: boolean;
  consentPilotStudy: boolean;
}): { ok: true } | { ok: false; error: string } {
  const emailTrim = input.email.trim();
  if (emailTrim && !isValidRasqDemoLeadEmail(emailTrim)) {
    return { ok: false, error: "Please enter a valid email address." };
  }

  const hasContactOrConsent = Boolean(
    input.name.trim() ||
      emailTrim ||
      input.phone.trim() ||
      input.mainGoal ||
      input.consentRasqUpdates ||
      input.consentPilotStudy,
  );

  if (!hasContactOrConsent) {
    return { ok: false, error: "Add at least one detail to share, or choose Skip." };
  }

  return { ok: true };
}

export function mapRasqDemoLeadPersistenceError(message: string): string {
  if (/rasq_demo_leads|relation .* does not exist|schema cache/i.test(message)) {
    return "Lead storage is not ready. Apply Supabase migration 026 (rasq_demo_leads) to your project.";
  }
  return message;
}
