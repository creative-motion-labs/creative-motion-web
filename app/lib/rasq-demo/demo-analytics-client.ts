import {
  buildRasqDemoAnalyticsIdempotencyKey,
  type RasqDemoAnalyticsCameraPath,
  type RasqDemoAnalyticsEventType,
  RASQ_DEMO_INTERNAL_TEST_PREFIX,
} from "./demo-analytics-types";

export { buildRasqDemoAnalyticsIdempotencyKey } from "./demo-analytics-types";

const VISITOR_SESSION_STORAGE_KEY = "rasq_demo_visitor_session_id";
const SENT_KEYS_STORAGE_KEY = "rasq_demo_analytics_sent_keys";

const inMemorySentKeys = new Set<string>();

function readSentKeysFromSessionStorage(): Set<string> {
  if (typeof sessionStorage === "undefined") return new Set();
  try {
    const raw = sessionStorage.getItem(SENT_KEYS_STORAGE_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((item): item is string => typeof item === "string"));
  } catch {
    return new Set();
  }
}

function persistSentKey(key: string): void {
  inMemorySentKeys.add(key);
  if (typeof sessionStorage === "undefined") return;
  try {
    const merged = readSentKeysFromSessionStorage();
    merged.add(key);
    sessionStorage.setItem(SENT_KEYS_STORAGE_KEY, JSON.stringify([...merged]));
  } catch {
    /* ignore quota / privacy mode */
  }
}

export function hasRasqDemoAnalyticsEventBeenSent(idempotencyKey: string): boolean {
  if (inMemorySentKeys.has(idempotencyKey)) return true;
  return readSentKeysFromSessionStorage().has(idempotencyKey);
}

export function markRasqDemoAnalyticsEventSent(idempotencyKey: string): void {
  persistSentKey(idempotencyKey);
}

export function createRasqDemoVisitorSessionId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `visitor-${Date.now()}`;
}

export function getOrCreateRasqDemoVisitorSessionId(options?: { internalTest?: boolean }): string {
  const internalTest = options?.internalTest === true;
  if (typeof sessionStorage !== "undefined") {
    try {
      const existing = sessionStorage.getItem(VISITOR_SESSION_STORAGE_KEY);
      if (existing) {
        if (internalTest && !existing.startsWith(RASQ_DEMO_INTERNAL_TEST_PREFIX)) {
          const testId = `${RASQ_DEMO_INTERNAL_TEST_PREFIX}${existing}`;
          sessionStorage.setItem(VISITOR_SESSION_STORAGE_KEY, testId);
          return testId;
        }
        return existing;
      }
    } catch {
      /* fall through */
    }
  }

  const base = createRasqDemoVisitorSessionId();
  const id = internalTest ? `${RASQ_DEMO_INTERNAL_TEST_PREFIX}${base}` : base;
  if (typeof sessionStorage !== "undefined") {
    try {
      sessionStorage.setItem(VISITOR_SESSION_STORAGE_KEY, id);
    } catch {
      /* ignore */
    }
  }
  return id;
}

export function createRasqDemoAttemptId(options?: { internalTest?: boolean }): string {
  const base =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `attempt-${Date.now()}`;
  return options?.internalTest ? `${RASQ_DEMO_INTERNAL_TEST_PREFIX}${base}` : base;
}

export function isRasqDemoAnalyticsTestModeFromSearch(search: string): boolean {
  if (!search) return false;
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const flag = params.get("rasqDemoTest") ?? params.get("demoTest");
  return flag === "1" || flag === "true";
}

export type TrackRasqDemoAnalyticsInput = {
  visitorSessionId: string;
  attemptId: string;
  eventType: RasqDemoAnalyticsEventType;
  cameraPath?: RasqDemoAnalyticsCameraPath | null;
  isInternalTest?: boolean;
};

/**
 * Fire-and-forget analytics POST. Never throws; dedupes by idempotency key in-memory and sessionStorage.
 */
export function trackRasqDemoAnalyticsEvent(input: TrackRasqDemoAnalyticsInput): void {
  const idempotencyKey = buildRasqDemoAnalyticsIdempotencyKey({
    visitorSessionId: input.visitorSessionId,
    attemptId: input.attemptId,
    eventType: input.eventType,
  });

  if (hasRasqDemoAnalyticsEventBeenSent(idempotencyKey)) {
    return;
  }

  markRasqDemoAnalyticsEventSent(idempotencyKey);

  const body = {
    visitorSessionId: input.visitorSessionId,
    attemptId: input.attemptId,
    eventType: input.eventType,
    cameraPath: input.cameraPath ?? null,
    isInternalTest: input.isInternalTest === true,
  };

  void fetch("/api/public/rasq-demo/analytics", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    keepalive: true,
  }).catch(() => {
    /* analytics must not interrupt demo */
  });
}

/** Test-only: reset dedupe state. */
export function __resetRasqDemoAnalyticsClientForTests(): void {
  inMemorySentKeys.clear();
}
