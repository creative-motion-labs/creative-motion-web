/**
 * Volunteer Shoulder Abduction Reach — Slice 8A protocol metadata (in-memory only).
 * Not therapist ground truth. Not clinical labels.
 */

import type { ShoulderAbductionReachSide } from "@/app/lib/shoulder-rehabilitation";

export const VOLUNTEER_TARGET_REPS = 3 as const;

/** Slice 8A pilot: right side only keeps the first public slice smaller. */
export const VOLUNTEER_CAPTURE_SIDE: ShoulderAbductionReachSide = "right";

export const VOLUNTEER_PROTOCOL_CONDITIONS = [
  "NORMAL",
  "SIMULATED_MILD_COMPENSATION",
  "SIMULATED_CLEAR_COMPENSATION",
] as const;

export type VolunteerProtocolCondition = (typeof VOLUNTEER_PROTOCOL_CONDITIONS)[number];

export type VolunteerWizardStep =
  | "welcome"
  | "consent"
  | "camera"
  | "condition"
  | "capture"
  | "summary";

export type VolunteerConsentState = {
  ageConfirmed: boolean;
  participationAgreed: boolean;
};

export function canProceedFromConsent(consent: VolunteerConsentState): boolean {
  return consent.ageConfirmed && consent.participationAgreed;
}

export function canProceedFromConsentWithCampaign(
  consent: VolunteerConsentState,
  campaignCode: string,
): boolean {
  return canProceedFromConsent(consent) && campaignCode.trim().length > 0;
}

export function isVolunteerProtocolCondition(value: string): value is VolunteerProtocolCondition {
  return (VOLUNTEER_PROTOCOL_CONDITIONS as readonly string[]).includes(value);
}

export const VOLUNTEER_PROTOCOL_CONDITION_LABELS: Record<VolunteerProtocolCondition, string> = {
  NORMAL: "Normal movement",
  SIMULATED_MILD_COMPENSATION: "Simulated mild adjustment",
  SIMULATED_CLEAR_COMPENSATION: "Simulated obvious adjustment",
};

export const VOLUNTEER_PROTOCOL_CONDITION_INSTRUCTIONS: Record<VolunteerProtocolCondition, string> = {
  NORMAL: "Perform the shoulder movement naturally within a comfortable, pain-free range.",
  SIMULATED_MILD_COMPENSATION:
    "Perform the movement while intentionally adding a small visible trunk or shoulder adjustment. Optional — skip if uncomfortable.",
  SIMULATED_CLEAR_COMPENSATION:
    "Perform the movement while intentionally adding an obvious trunk or shoulder adjustment. Optional — skip if uncomfortable.",
};

/** Non-clinical movement safety reminders shown before and during capture. */
export const VOLUNTEER_MOVEMENT_SAFETY_REMINDERS = [
  "Use only a comfortable, pain-free range of motion.",
  "Do not force your arm, trunk, or shoulder into any position.",
  "Stop immediately for pain, dizziness, unusual shortness of breath, discomfort, or if you feel unsafe.",
  "Simulated compensation is optional — do not attempt it if uncomfortable.",
] as const;

export type VolunteerSessionSummary = {
  capturedCount: number;
  rejectedCount: number;
  protocolCondition: VolunteerProtocolCondition;
  side: ShoulderAbductionReachSide;
  lastTrackingStatus: string;
};

export function buildVolunteerSessionSummary(input: {
  capturedCount: number;
  rejectedCount: number;
  protocolCondition: VolunteerProtocolCondition;
  side: ShoulderAbductionReachSide;
  lastTrackingStatus: string;
}): VolunteerSessionSummary {
  return {
    capturedCount: input.capturedCount,
    rejectedCount: input.rejectedCount,
    protocolCondition: input.protocolCondition,
    side: input.side,
    lastTrackingStatus: input.lastTrackingStatus,
  };
}

export function isCaptureComplete(capturedCount: number): boolean {
  return capturedCount >= VOLUNTEER_TARGET_REPS;
}
