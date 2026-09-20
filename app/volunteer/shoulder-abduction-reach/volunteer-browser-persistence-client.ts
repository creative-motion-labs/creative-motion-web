/**
 * Browser-safe typed client for volunteer research persistence APIs (Slice 8B.3).
 * No server-only imports. Session token travels only via x-volunteer-session-token header.
 */

import {
  VOLUNTEER_CONSENT_VERSION,
  VOLUNTEER_PROTOCOL_VERSION,
  VOLUNTEER_SESSION_TOKEN_HEADER,
} from "@/app/lib/research/volunteer-constants";
import type { VolunteerProtocolCondition } from "@/app/lib/research/volunteer-constants";
import type { ValidatedVolunteerRepetitionPayload } from "@/app/lib/research/volunteer-repetition-validation";

export const VOLUNTEER_PERSISTENCE_API_ROUTES = {
  sessions: "/api/research/volunteer/sessions",
  movementSessions: "/api/research/volunteer/movement-sessions",
  repetitions: "/api/research/volunteer/repetitions",
  complete: "/api/research/volunteer/session/complete",
} as const;

export type VolunteerSessionCreateRequest = {
  campaignCode: string;
  ageConfirmed18Plus: true;
  consentVersion: typeof VOLUNTEER_CONSENT_VERSION;
  protocolVersion: typeof VOLUNTEER_PROTOCOL_VERSION;
};

export type VolunteerSessionCreateSuccess = {
  sessionToken: string;
  expiresAt: string;
};

export type VolunteerMovementSessionRequest = {
  movementType: "shoulder_abduction_reach";
  protocolCondition: VolunteerProtocolCondition;
  side: "right";
};

export type VolunteerMovementSessionSuccess = {
  movementSessionId: string;
  blockIndex: number;
};

export type VolunteerRepetitionSuccess = {
  repetitionId: string;
  created: boolean;
};

export type VolunteerCompleteSuccess =
  | { ok: true; deletionCode: string }
  | { ok: true; alreadyCompleted: true };

export type VolunteerPersistenceClientErrorKind =
  | "invalid_campaign"
  | "feature_disabled"
  | "validation"
  | "session_expired"
  | "conflict"
  | "payload_too_large"
  | "rate_limited"
  | "retryable"
  | "fatal"
  | "malformed_response";

export type VolunteerPersistenceClientError = {
  kind: VolunteerPersistenceClientErrorKind;
  retryable: boolean;
};

export type VolunteerPersistenceFetchImpl = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function parseSessionCreateResponse(value: unknown): VolunteerSessionCreateSuccess | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  if (!isNonEmptyString(record.sessionToken) || !isNonEmptyString(record.expiresAt)) {
    return null;
  }
  return { sessionToken: record.sessionToken, expiresAt: record.expiresAt };
}

function parseMovementSessionResponse(value: unknown): VolunteerMovementSessionSuccess | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  if (!isNonEmptyString(record.movementSessionId)) return null;
  if (typeof record.blockIndex !== "number" || !Number.isInteger(record.blockIndex)) return null;
  return { movementSessionId: record.movementSessionId, blockIndex: record.blockIndex };
}

function parseRepetitionResponse(value: unknown): VolunteerRepetitionSuccess | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  if (!isNonEmptyString(record.repetitionId)) return null;
  if (typeof record.created !== "boolean") return null;
  return { repetitionId: record.repetitionId, created: record.created };
}

function parseCompleteResponse(value: unknown): VolunteerCompleteSuccess | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  if (record.ok !== true) return null;
  if (record.alreadyCompleted === true) {
    return { ok: true, alreadyCompleted: true };
  }
  if (isNonEmptyString(record.deletionCode)) {
    return { ok: true, deletionCode: record.deletionCode };
  }
  return null;
}

function classifyHttpError(status: number): VolunteerPersistenceClientError {
  if (status === 404) {
    return { kind: "session_expired", retryable: false };
  }
  if (status === 409) {
    return { kind: "conflict", retryable: false };
  }
  if (status === 413) {
    return { kind: "payload_too_large", retryable: false };
  }
  if (status === 429) {
    return { kind: "rate_limited", retryable: true };
  }
  if (status === 503) {
    return { kind: "feature_disabled", retryable: false };
  }
  if (status >= 500) {
    return { kind: "retryable", retryable: true };
  }
  if (status === 400 || status === 415) {
    return { kind: "validation", retryable: false };
  }
  return { kind: "fatal", retryable: false };
}

async function readJsonBody(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function jsonRequestInit(
  body: unknown,
  sessionToken?: string,
  signal?: AbortSignal,
): RequestInit {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (sessionToken) {
    headers[VOLUNTEER_SESSION_TOKEN_HEADER] = sessionToken;
  }
  return {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    cache: "no-store",
    credentials: "omit",
    signal,
  };
}

function patchRequestInit(sessionToken: string, signal?: AbortSignal): RequestInit {
  return {
    method: "PATCH",
    headers: {
      [VOLUNTEER_SESSION_TOKEN_HEADER]: sessionToken,
    },
    cache: "no-store",
    credentials: "omit",
    signal,
  };
}

export type VolunteerBrowserPersistenceClient = {
  createSession: (
    campaignCode: string,
    signal?: AbortSignal,
  ) => Promise<
    | { ok: true; value: VolunteerSessionCreateSuccess }
    | { ok: false; error: VolunteerPersistenceClientError }
  >;
  createMovementSession: (
    sessionToken: string,
    request: VolunteerMovementSessionRequest,
    signal?: AbortSignal,
  ) => Promise<
    | { ok: true; value: VolunteerMovementSessionSuccess }
    | { ok: false; error: VolunteerPersistenceClientError }
  >;
  submitRepetition: (
    sessionToken: string,
    payload: ValidatedVolunteerRepetitionPayload,
    signal?: AbortSignal,
  ) => Promise<
    | { ok: true; value: VolunteerRepetitionSuccess }
    | { ok: false; error: VolunteerPersistenceClientError }
  >;
  completeSession: (
    sessionToken: string,
    signal?: AbortSignal,
  ) => Promise<
    | { ok: true; value: VolunteerCompleteSuccess }
    | { ok: false; error: VolunteerPersistenceClientError }
  >;
};

export function createVolunteerBrowserPersistenceClient(
  fetchImpl: VolunteerPersistenceFetchImpl = fetch,
): VolunteerBrowserPersistenceClient {
  return {
    async createSession(campaignCode, signal) {
      const body: VolunteerSessionCreateRequest = {
        campaignCode: campaignCode.trim(),
        ageConfirmed18Plus: true,
        consentVersion: VOLUNTEER_CONSENT_VERSION,
        protocolVersion: VOLUNTEER_PROTOCOL_VERSION,
      };

      let response: Response;
      try {
        response = await fetchImpl(
          VOLUNTEER_PERSISTENCE_API_ROUTES.sessions,
          jsonRequestInit(body, undefined, signal),
        );
      } catch {
        return { ok: false, error: { kind: "retryable", retryable: true } };
      }

      const json = await readJsonBody(response);
      if (response.ok) {
        const parsed = parseSessionCreateResponse(json);
        if (!parsed) {
          return { ok: false, error: { kind: "malformed_response", retryable: false } };
        }
        return { ok: true, value: parsed };
      }

      if (response.status === 404) {
        return { ok: false, error: { kind: "invalid_campaign", retryable: false } };
      }
      return { ok: false, error: classifyHttpError(response.status) };
    },

    async createMovementSession(sessionToken, request, signal) {
      let response: Response;
      try {
        response = await fetchImpl(
          VOLUNTEER_PERSISTENCE_API_ROUTES.movementSessions,
          jsonRequestInit(request, sessionToken, signal),
        );
      } catch {
        return { ok: false, error: { kind: "retryable", retryable: true } };
      }

      const json = await readJsonBody(response);
      if (response.ok) {
        const parsed = parseMovementSessionResponse(json);
        if (!parsed) {
          return { ok: false, error: { kind: "malformed_response", retryable: false } };
        }
        return { ok: true, value: parsed };
      }
      return { ok: false, error: classifyHttpError(response.status) };
    },

    async submitRepetition(sessionToken, payload, signal) {
      let response: Response;
      try {
        response = await fetchImpl(
          VOLUNTEER_PERSISTENCE_API_ROUTES.repetitions,
          jsonRequestInit(payload, sessionToken, signal),
        );
      } catch {
        return { ok: false, error: { kind: "retryable", retryable: true } };
      }

      const json = await readJsonBody(response);
      if (response.ok) {
        const parsed = parseRepetitionResponse(json);
        if (!parsed) {
          return { ok: false, error: { kind: "malformed_response", retryable: false } };
        }
        return { ok: true, value: parsed };
      }
      return { ok: false, error: classifyHttpError(response.status) };
    },

    async completeSession(sessionToken, signal) {
      let response: Response;
      try {
        response = await fetchImpl(
          VOLUNTEER_PERSISTENCE_API_ROUTES.complete,
          patchRequestInit(sessionToken, signal),
        );
      } catch {
        return { ok: false, error: { kind: "retryable", retryable: true } };
      }

      const json = await readJsonBody(response);
      if (response.ok) {
        const parsed = parseCompleteResponse(json);
        if (!parsed) {
          return { ok: false, error: { kind: "malformed_response", retryable: false } };
        }
        return { ok: true, value: parsed };
      }
      return { ok: false, error: classifyHttpError(response.status) };
    },
  };
}
