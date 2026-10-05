import {
  buildRasqDemoAnalyticsIdempotencyKey,
  type RasqDemoAnalyticsCameraPath,
  type RasqDemoAnalyticsEventType,
  RASQ_DEMO_INTERNAL_TEST_PREFIX,
} from "./demo-analytics-types";

export { buildRasqDemoAnalyticsIdempotencyKey } from "./demo-analytics-types";

export const RASQ_DEMO_VISITOR_SESSION_STORAGE_KEY = "rasq_demo_visitor_session_id";
export const RASQ_DEMO_VISITOR_SESSION_STORAGE_KEY_TEST = "rasq_demo_visitor_session_id_test";
const SENT_KEYS_STORAGE_KEY = "rasq_demo_analytics_sent_keys";
const SENT_KEYS_STORAGE_KEY_TEST = "rasq_demo_analytics_sent_keys_test";

const MAX_ANALYTICS_POST_ATTEMPTS = 3;
const ANALYTICS_RETRY_BASE_MS = 250;

const inMemorySentKeysNormal = new Set<string>();
const inMemorySentKeysTest = new Set<string>();
const inFlightByKey = new Map<string, Promise<void>>();

type AnalyticsFetchFn = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

let fetchOverride: AnalyticsFetchFn | undefined;

/** Test-only — inject fetch for retry / persistence tests. */
export function __setRasqDemoAnalyticsFetchForTests(fn: AnalyticsFetchFn | undefined): void {
  fetchOverride = fn;
}

function resolveFetch(): AnalyticsFetchFn {
  if (fetchOverride) return fetchOverride;
  if (typeof fetch !== "undefined") return fetch;
  return async () => {
    throw new Error("fetch is not available");
  };
}

function sentKeysStore(internalTest: boolean): Set<string> {
  return internalTest ? inMemorySentKeysTest : inMemorySentKeysNormal;
}

function sentKeysStorageKey(internalTest: boolean): string {
  return internalTest ? SENT_KEYS_STORAGE_KEY_TEST : SENT_KEYS_STORAGE_KEY;
}

function visitorStorageKey(internalTest: boolean): string {
  return internalTest
    ? RASQ_DEMO_VISITOR_SESSION_STORAGE_KEY_TEST
    : RASQ_DEMO_VISITOR_SESSION_STORAGE_KEY;
}

function readSentKeysFromSessionStorage(internalTest: boolean): Set<string> {
  if (typeof sessionStorage === "undefined") return new Set();
  try {
    const raw = sessionStorage.getItem(sentKeysStorageKey(internalTest));
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((item): item is string => typeof item === "string"));
  } catch {
    return new Set();
  }
}

function persistSentKey(idempotencyKey: string, internalTest: boolean): void {
  sentKeysStore(internalTest).add(idempotencyKey);
  if (typeof sessionStorage === "undefined") return;
  try {
    const merged = readSentKeysFromSessionStorage(internalTest);
    merged.add(idempotencyKey);
    sessionStorage.setItem(sentKeysStorageKey(internalTest), JSON.stringify([...merged]));
  } catch {
    /* ignore quota / privacy mode */
  }
}

export function hasRasqDemoAnalyticsEventBeenSent(
  idempotencyKey: string,
  internalTest = false,
): boolean {
  if (sentKeysStore(internalTest).has(idempotencyKey)) return true;
  return readSentKeysFromSessionStorage(internalTest).has(idempotencyKey);
}

export function markRasqDemoAnalyticsEventSent(
  idempotencyKey: string,
  internalTest = false,
): void {
  persistSentKey(idempotencyKey, internalTest);
}

export function createRasqDemoVisitorSessionId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `visitor-${Date.now()}`;
}

export function getOrCreateRasqDemoVisitorSessionId(options?: { internalTest?: boolean }): string {
  const internalTest = options?.internalTest === true;
  const storageKey = visitorStorageKey(internalTest);

  if (typeof sessionStorage !== "undefined") {
    try {
      const existing = sessionStorage.getItem(storageKey);
      if (existing) {
        if (internalTest && !existing.startsWith(RASQ_DEMO_INTERNAL_TEST_PREFIX)) {
          const testId = `${RASQ_DEMO_INTERNAL_TEST_PREFIX}${existing}`;
          sessionStorage.setItem(storageKey, testId);
          return testId;
        }
        if (!internalTest && existing.startsWith(RASQ_DEMO_INTERNAL_TEST_PREFIX)) {
          /* ignore stale test id in normal namespace */
        } else {
          return existing;
        }
      }
    } catch {
      /* fall through */
    }
  }

  const base = createRasqDemoVisitorSessionId();
  const id = internalTest ? `${RASQ_DEMO_INTERNAL_TEST_PREFIX}${base}` : base;
  if (typeof sessionStorage !== "undefined") {
    try {
      sessionStorage.setItem(storageKey, id);
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

function shouldRetryAnalyticsResponse(status: number): boolean {
  return status === 429 || status >= 500;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function postRasqDemoAnalyticsEventWithRetry(input: TrackRasqDemoAnalyticsInput): Promise<boolean> {
  const body = {
    visitorSessionId: input.visitorSessionId,
    attemptId: input.attemptId,
    eventType: input.eventType,
    cameraPath: input.cameraPath ?? null,
    isInternalTest: input.isInternalTest === true,
  };

  const fetchFn = resolveFetch();
  let lastError: unknown;

  for (let attempt = 0; attempt < MAX_ANALYTICS_POST_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetchFn("/api/public/rasq-demo/analytics", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        keepalive: attempt === 0,
      });

      let parsed: { ok?: boolean; duplicate?: boolean } | null = null;
      try {
        parsed = (await response.json()) as { ok?: boolean; duplicate?: boolean };
      } catch {
        parsed = null;
      }

      if (response.ok && parsed?.ok === true) {
        return true;
      }

      if (!shouldRetryAnalyticsResponse(response.status)) {
        return false;
      }
    } catch (error) {
      lastError = error;
    }

    if (attempt < MAX_ANALYTICS_POST_ATTEMPTS - 1) {
      await sleep(ANALYTICS_RETRY_BASE_MS * (attempt + 1));
    }
  }

  void lastError;
  return false;
}

/**
 * Fire-and-forget analytics POST. Never throws; marks sent only after server confirms persistence.
 */
export function trackRasqDemoAnalyticsEvent(input: TrackRasqDemoAnalyticsInput): void {
  const internalTest = input.isInternalTest === true;
  const idempotencyKey = buildRasqDemoAnalyticsIdempotencyKey({
    visitorSessionId: input.visitorSessionId,
    attemptId: input.attemptId,
    eventType: input.eventType,
  });

  if (hasRasqDemoAnalyticsEventBeenSent(idempotencyKey, internalTest)) {
    return;
  }

  const existingFlight = inFlightByKey.get(idempotencyKey);
  if (existingFlight) {
    void existingFlight;
    return;
  }

  const flight = (async () => {
    const persisted = await postRasqDemoAnalyticsEventWithRetry(input);
    if (persisted) {
      markRasqDemoAnalyticsEventSent(idempotencyKey, internalTest);
    }
  })().finally(() => {
    inFlightByKey.delete(idempotencyKey);
  });

  inFlightByKey.set(idempotencyKey, flight);
  void flight.catch(() => {
    /* analytics must not interrupt demo */
  });
}

/** Test-only: wait for in-flight analytics posts. */
export async function __flushRasqDemoAnalyticsInFlightForTests(): Promise<void> {
  await Promise.all([...inFlightByKey.values()]);
}

/** Test-only: reset dedupe state. */
export function __resetRasqDemoAnalyticsClientForTests(): void {
  inMemorySentKeysNormal.clear();
  inMemorySentKeysTest.clear();
  inFlightByKey.clear();
  fetchOverride = undefined;
}
