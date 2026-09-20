import type { SupabaseClient } from "@supabase/supabase-js";
import {
  hashVolunteerRepetitionPayload,
  type ValidatedVolunteerRepetitionPayload,
} from "./volunteer-repetition-validation";
import { MOVEMENT_TABLE } from "./volunteer-session-store";

export const REPETITION_TABLE = "ml_research_volunteer_repetitions";

export type VolunteerRepetitionRow = {
  id: string;
  movement_session_id: string;
  client_submission_id: string;
  repetition_index: number;
  capture_schema_version: string;
  feature_schema_version: string;
  started_at_ms: number;
  ended_at_ms: number;
  frames: unknown;
  derived_features: unknown;
  payload_hash: string;
  created_at: string;
};

export type PersistVolunteerRepetitionResult =
  | { ok: true; repetitionId: string; created: boolean }
  | { ok: false; reason: "movement_not_found" | "payload_conflict" };

export async function getMovementSessionOwnedByCollection(
  admin: SupabaseClient,
  movementSessionId: string,
  collectionSessionId: string,
) {
  const { data, error } = await admin
    .from(MOVEMENT_TABLE)
    .select("id, collection_session_id, movement_type, side")
    .eq("id", movementSessionId)
    .eq("collection_session_id", collectionSessionId)
    .maybeSingle();

  if (error) throw error;
  return data as
    | {
        id: string;
        collection_session_id: string;
        movement_type: string;
        side: string;
      }
    | null;
}

export async function persistVolunteerRepetition(
  admin: SupabaseClient,
  collectionSessionId: string,
  payload: ValidatedVolunteerRepetitionPayload,
): Promise<PersistVolunteerRepetitionResult> {
  const movement = await getMovementSessionOwnedByCollection(
    admin,
    payload.movementSessionId,
    collectionSessionId,
  );
  if (!movement) {
    return { ok: false, reason: "movement_not_found" };
  }

  const payloadHash = hashVolunteerRepetitionPayload(payload);

  const { data, error } = await admin
    .from(REPETITION_TABLE)
    .insert({
      movement_session_id: payload.movementSessionId,
      client_submission_id: payload.clientSubmissionId,
      repetition_index: payload.repetitionIndex,
      capture_schema_version: payload.captureSchemaVersion,
      feature_schema_version: payload.featureSchemaVersion,
      started_at_ms: payload.startedAtMs,
      ended_at_ms: payload.endedAtMs,
      frames: payload.frames,
      derived_features: payload.derivedFeatures,
      payload_hash: payloadHash,
    })
    .select("id")
    .single();

  if (!error && data) {
    return { ok: true, repetitionId: (data as { id: string }).id, created: true };
  }

  if (error?.code !== "23505") {
    throw error;
  }

  const { data: existing, error: existingError } = await admin
    .from(REPETITION_TABLE)
    .select("id, payload_hash")
    .eq("movement_session_id", payload.movementSessionId)
    .eq("client_submission_id", payload.clientSubmissionId)
    .maybeSingle();

  if (existingError) throw existingError;
  if (!existing) {
    throw error;
  }

  const row = existing as { id: string; payload_hash: string };
  if (row.payload_hash === payloadHash) {
    return { ok: true, repetitionId: row.id, created: false };
  }

  return { ok: false, reason: "payload_conflict" };
}
