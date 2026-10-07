export const VOLUNTEER_CONSENT_VERSION = "volunteer-ml-capture-1.0" as const;
export const VOLUNTEER_PROTOCOL_VERSION = "shoulder-abduction-volunteer-v1" as const;

export const VOLUNTEER_SESSION_TOKEN_HEADER = "x-volunteer-session-token" as const;

export const VOLUNTEER_SESSION_TTL_MS = 4 * 60 * 60 * 1000;

export const VOLUNTEER_MOVEMENT_TYPES = ["shoulder_abduction_reach"] as const;
export type VolunteerMovementType = (typeof VOLUNTEER_MOVEMENT_TYPES)[number];

export const VOLUNTEER_PROTOCOL_CONDITIONS = [
  "NORMAL",
  "SIMULATED_MILD_COMPENSATION",
  "SIMULATED_CLEAR_COMPENSATION",
] as const;
export type VolunteerProtocolCondition = (typeof VOLUNTEER_PROTOCOL_CONDITIONS)[number];

export const VOLUNTEER_SIDES = ["left", "right"] as const;
export type VolunteerSide = (typeof VOLUNTEER_SIDES)[number];

/** Slice 8A pilot uses right side only — keep API aligned until multi-side is approved. */
export const VOLUNTEER_PILOT_SIDE: VolunteerSide = "right";

export const VOLUNTEER_COLLECTION_SESSION_STATUSES = ["active", "completed", "expired"] as const;
export type VolunteerCollectionSessionStatus = (typeof VOLUNTEER_COLLECTION_SESSION_STATUSES)[number];
