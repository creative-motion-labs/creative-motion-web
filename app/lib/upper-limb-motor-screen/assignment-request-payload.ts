/**
 * Canonical allowlisted assignment request snapshot for idempotency.
 * Browser-safe — no Node crypto.
 */

import type { ForwardReachAssignmentRequestPayload } from "./forward-reach-assignment-client";

export type ForwardReachAssignmentRequestSnapshot = {
  patientId: string;
  screenDefinitionId: string;
  affectedSide: string;
  configuration: ForwardReachAssignmentRequestPayload["configuration"];
  taskAssignmentGroups: ForwardReachAssignmentRequestPayload["taskAssignmentGroups"];
};

export type ForwardReachAssignmentRequestSnapshotInput = Omit<
  ForwardReachAssignmentRequestPayload,
  "assignmentRequestId"
>;

export function buildForwardReachAssignmentRequestSnapshot(
  payload: ForwardReachAssignmentRequestSnapshotInput,
): ForwardReachAssignmentRequestSnapshot {
  return {
    patientId: payload.patientId.trim(),
    screenDefinitionId: payload.screenDefinitionId,
    affectedSide: payload.affectedSide,
    configuration: payload.configuration,
    taskAssignmentGroups: payload.taskAssignmentGroups,
  };
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(obj[key])}`).join(",")}}`;
}

/** Deterministic fingerprint for one logical Forward Reach assignment attempt. */
export function buildForwardReachAssignmentFingerprint(
  payload: ForwardReachAssignmentRequestSnapshotInput,
): string {
  const snapshot = buildForwardReachAssignmentRequestSnapshot(payload);
  return stableStringify(snapshot);
}

/** Canonical serialized form used for server-side payload hash comparison. */
export function serializeForwardReachAssignmentRequestSnapshot(
  snapshot: ForwardReachAssignmentRequestSnapshot,
): string {
  return stableStringify(snapshot);
}
