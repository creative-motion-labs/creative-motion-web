export const RASQ_DEMO_ANALYTICS_EVENT_TYPES = [
  "demo_visit",
  "demo_started",
  "demo_completed",
  "follow_up_interested",
  "follow_up_not_interested",
  "follow_up_skipped",
] as const;

export type RasqDemoAnalyticsEventType = (typeof RASQ_DEMO_ANALYTICS_EVENT_TYPES)[number];

export type RasqDemoAnalyticsCameraPath = "camera" | "no_camera";

export type RasqDemoAnalyticsPayload = {
  visitorSessionId: string;
  attemptId: string;
  eventType: RasqDemoAnalyticsEventType;
  cameraPath: RasqDemoAnalyticsCameraPath | null;
  isInternalTest: boolean;
};

export const RASQ_DEMO_INTERNAL_TEST_PREFIX = "rasq-demo-internal-test-";

export function isRasqDemoInternalTestSessionId(id: string): boolean {
  return id.startsWith(RASQ_DEMO_INTERNAL_TEST_PREFIX);
}

export function buildRasqDemoAnalyticsIdempotencyKey(input: {
  visitorSessionId: string;
  attemptId: string;
  eventType: RasqDemoAnalyticsEventType;
}): string {
  if (input.eventType === "demo_visit") {
    return `${input.visitorSessionId}:demo_visit`;
  }
  return `${input.attemptId}:${input.eventType}`;
}
