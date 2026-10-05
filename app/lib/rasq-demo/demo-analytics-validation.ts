import {
  RASQ_DEMO_ANALYTICS_EVENT_TYPES,
  type RasqDemoAnalyticsCameraPath,
  type RasqDemoAnalyticsEventType,
  type RasqDemoAnalyticsPayload,
  isRasqDemoInternalTestSessionId,
} from "./demo-analytics-types";

const ALLOWED_KEYS = new Set([
  "visitorSessionId",
  "attemptId",
  "eventType",
  "cameraPath",
  "isInternalTest",
]);

const EVENT_TYPE_SET = new Set<RasqDemoAnalyticsEventType>(RASQ_DEMO_ANALYTICS_EVENT_TYPES);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function trimId(value: unknown, maxLen: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, maxLen);
}

function parseCameraPath(value: unknown): RasqDemoAnalyticsPayload["cameraPath"] {
  if (value === undefined || value === null || value === "") return null;
  if (value === "camera" || value === "no_camera") return value;
  return null;
}

export type RasqDemoAnalyticsValidationResult =
  | { ok: true; value: RasqDemoAnalyticsPayload }
  | { ok: false; error: string };

export function validateRasqDemoAnalyticsBody(body: unknown): RasqDemoAnalyticsValidationResult {
  if (!isPlainObject(body)) {
    return { ok: false, error: "Invalid request body." };
  }

  for (const key of Object.keys(body)) {
    if (!ALLOWED_KEYS.has(key)) {
      return { ok: false, error: `Unexpected field: ${key}` };
    }
  }

  const visitorSessionId = trimId(body.visitorSessionId, 64);
  const attemptId = trimId(body.attemptId, 64);
  if (!visitorSessionId) {
    return { ok: false, error: "visitorSessionId is required." };
  }
  if (!attemptId) {
    return { ok: false, error: "attemptId is required." };
  }

  if (typeof body.eventType !== "string" || !EVENT_TYPE_SET.has(body.eventType as RasqDemoAnalyticsEventType)) {
    return { ok: false, error: "eventType is invalid." };
  }
  const eventType = body.eventType as RasqDemoAnalyticsEventType;

  const cameraPath = parseCameraPath(body.cameraPath);
  if (
    body.cameraPath !== undefined &&
    body.cameraPath !== null &&
    body.cameraPath !== "" &&
    cameraPath === null
  ) {
    return { ok: false, error: "cameraPath must be camera or no_camera." };
  }

  if (eventType === "demo_started" || eventType === "demo_completed") {
    if (!cameraPath) {
      return { ok: false, error: "cameraPath is required for demo_started and demo_completed." };
    }
  }

  let isInternalTest = body.isInternalTest === true;
  if (
    isRasqDemoInternalTestSessionId(visitorSessionId) ||
    isRasqDemoInternalTestSessionId(attemptId)
  ) {
    isInternalTest = true;
  }

  return {
    ok: true,
    value: {
      visitorSessionId,
      attemptId,
      eventType,
      cameraPath,
      isInternalTest,
    },
  };
}

export function mapRasqDemoAnalyticsPersistenceError(message: string): string {
  if (/rasq_demo_analytics|relation .* does not exist|schema cache/i.test(message)) {
    return "Demo analytics storage is not ready. Apply Supabase migration 027 (rasq_demo_analytics_events).";
  }
  return message;
}
