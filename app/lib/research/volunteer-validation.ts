import {
  VOLUNTEER_CONSENT_VERSION,
  VOLUNTEER_MOVEMENT_TYPES,
  VOLUNTEER_PILOT_SIDE,
  VOLUNTEER_PROTOCOL_CONDITIONS,
  VOLUNTEER_PROTOCOL_VERSION,
  type VolunteerMovementType,
  type VolunteerProtocolCondition,
  type VolunteerSide,
} from "./volunteer-constants";

export type VolunteerSessionCreateBody = {
  campaignCode?: unknown;
  consentVersion?: unknown;
  consentAcceptedAtMs?: unknown;
  ageConfirmed18Plus?: unknown;
  protocolVersion?: unknown;
};

export type VolunteerMovementSessionBody = {
  movementType?: unknown;
  protocolCondition?: unknown;
  side?: unknown;
};

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

const SESSION_CREATE_ALLOWED_KEYS = new Set([
  "campaignCode",
  "ageConfirmed18Plus",
  "consentVersion",
  "protocolVersion",
]);

const MOVEMENT_SESSION_ALLOWED_KEYS = new Set([
  "movementType",
  "protocolCondition",
  "side",
]);

const SERVER_OWNED_REJECTED_KEYS = new Set([
  "participantId",
  "participant_id",
  "collectionSessionId",
  "collection_session_id",
  "status",
  "sessionToken",
  "session_token",
  "session_token_hash",
  "sessionTokenHash",
  "deletionCode",
  "deletion_code",
  "deletion_code_hash",
  "deletionCodeHash",
  "createdAt",
  "created_at",
  "completedAt",
  "completed_at",
  "token_expires_at",
  "tokenExpiresAt",
  "consent_accepted_at_ms",
  "consentAcceptedAtMs",
]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function rejectDisallowedBodyKeys(
  body: unknown,
  allowedKeys: Set<string>,
): ValidationResult<Record<string, unknown>> {
  if (!isPlainObject(body)) {
    return { ok: false, error: "Invalid request body." };
  }

  for (const key of Object.keys(body)) {
    if (SERVER_OWNED_REJECTED_KEYS.has(key)) {
      return { ok: false, error: "Request contains unsupported fields." };
    }
    if (!allowedKeys.has(key)) {
      return { ok: false, error: "Request contains unsupported fields." };
    }
    const value = body[key];
    if (value !== null && typeof value === "object") {
      return { ok: false, error: "Request contains unsupported fields." };
    }
  }

  return { ok: true, value: body };
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isAllowedEnumValue<T extends readonly string[]>(
  value: unknown,
  allowed: T,
): value is T[number] {
  return typeof value === "string" && (allowed as readonly string[]).includes(value);
}

export type ValidatedSessionCreateInput = {
  campaignCode: string;
  consentVersion: string;
  protocolVersion: string;
};

export function validateVolunteerSessionCreateBody(
  body: VolunteerSessionCreateBody,
): ValidationResult<ValidatedSessionCreateInput> {
  const shape = rejectDisallowedBodyKeys(body, SESSION_CREATE_ALLOWED_KEYS);
  if (!shape.ok) return shape;

  const record = shape.value;

  if (!isNonEmptyString(record.campaignCode)) {
    return { ok: false, error: "Campaign code is required." };
  }

  if (record.ageConfirmed18Plus !== true) {
    return { ok: false, error: "Age confirmation is required." };
  }

  if (
    !isNonEmptyString(record.consentVersion) ||
    record.consentVersion !== VOLUNTEER_CONSENT_VERSION
  ) {
    return { ok: false, error: "Consent version is invalid." };
  }

  if (
    !isNonEmptyString(record.protocolVersion) ||
    record.protocolVersion !== VOLUNTEER_PROTOCOL_VERSION
  ) {
    return { ok: false, error: "Protocol version is invalid." };
  }

  return {
    ok: true,
    value: {
      campaignCode: record.campaignCode.trim(),
      consentVersion: record.consentVersion,
      protocolVersion: record.protocolVersion,
    },
  };
}

export type ValidatedMovementSessionInput = {
  movementType: VolunteerMovementType;
  protocolCondition: VolunteerProtocolCondition;
  side: VolunteerSide;
};

export function validateVolunteerMovementSessionBody(
  body: VolunteerMovementSessionBody,
): ValidationResult<ValidatedMovementSessionInput> {
  const shape = rejectDisallowedBodyKeys(body, MOVEMENT_SESSION_ALLOWED_KEYS);
  if (!shape.ok) return shape;

  const record = shape.value;

  if (!isAllowedEnumValue(record.movementType, VOLUNTEER_MOVEMENT_TYPES)) {
    return { ok: false, error: "Movement type is not supported." };
  }

  if (!isAllowedEnumValue(record.protocolCondition, VOLUNTEER_PROTOCOL_CONDITIONS)) {
    return { ok: false, error: "Protocol condition is not supported." };
  }

  if (!isAllowedEnumValue(record.side, [VOLUNTEER_PILOT_SIDE])) {
    return { ok: false, error: "Side is not supported for this pilot." };
  }

  return {
    ok: true,
    value: {
      movementType: record.movementType,
      protocolCondition: record.protocolCondition,
      side: record.side,
    },
  };
}
