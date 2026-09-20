import { createClient as createAdminClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import {
  generateVolunteerDeletionCode,
  generateVolunteerSessionToken,
  hashVolunteerSecret,
} from "./volunteer-crypto";
import {
  VOLUNTEER_PROTOCOL_VERSION,
  VOLUNTEER_SESSION_TTL_MS,
  type VolunteerCollectionSessionStatus,
  type VolunteerMovementType,
  type VolunteerProtocolCondition,
  type VolunteerSide,
} from "./volunteer-constants";

const COLLECTION_TABLE = "ml_research_volunteer_collection_sessions";
const MOVEMENT_TABLE = "ml_research_volunteer_movement_sessions";

export type VolunteerCollectionSessionRow = {
  id: string;
  participant_id: string;
  session_token_hash: string;
  token_expires_at: string;
  status: VolunteerCollectionSessionStatus;
  age_confirmed_18_plus: boolean;
  consent_version: string;
  consent_accepted_at_ms: number;
  protocol_version: string;
  deletion_code_hash: string | null;
  created_at: string;
  completed_at: string | null;
};

export type VolunteerMovementSessionRow = {
  id: string;
  collection_session_id: string;
  block_index: number;
  movement_type: VolunteerMovementType;
  side: VolunteerSide;
  protocol_condition: VolunteerProtocolCondition;
  created_at: string;
};

let serviceRoleClientOverride: SupabaseClient | null = null;

/** Test-only hook — not used in production. */
export function __setVolunteerServiceRoleClientForTests(client: SupabaseClient | null): void {
  serviceRoleClientOverride = client;
}

export function getVolunteerResearchAdminClient(): SupabaseClient | null {
  if (serviceRoleClientOverride) return serviceRoleClientOverride;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const svc = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !svc) return null;
  return createAdminClient(url, svc, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function isExpired(iso: string): boolean {
  return Date.parse(iso) <= Date.now();
}

export type CreateCollectionSessionInput = {
  consentVersion: string;
  protocolVersion: string;
};

export type CreateCollectionSessionResult = {
  sessionToken: string;
  expiresAt: string;
};

export async function createVolunteerCollectionSession(
  admin: SupabaseClient,
  input: CreateCollectionSessionInput,
): Promise<CreateCollectionSessionResult> {
  const sessionToken = generateVolunteerSessionToken();
  const sessionTokenHash = hashVolunteerSecret(sessionToken);
  const expiresAt = new Date(Date.now() + VOLUNTEER_SESSION_TTL_MS).toISOString();
  const participantId = randomUUID();
  const consentAcceptedAtMs = Date.now();

  const { error } = await admin.from(COLLECTION_TABLE).insert({
    participant_id: participantId,
    session_token_hash: sessionTokenHash,
    token_expires_at: expiresAt,
    status: "active",
    age_confirmed_18_plus: true,
    consent_version: input.consentVersion,
    consent_accepted_at_ms: consentAcceptedAtMs,
    protocol_version: input.protocolVersion,
  });

  if (error) throw error;

  return { sessionToken, expiresAt };
}

export type ResolveCollectionSessionResult =
  | { ok: true; session: VolunteerCollectionSessionRow }
  | { ok: false; reason: "not_found" | "expired" | "completed" | "inactive" };

async function fetchCollectionSessionByTokenHash(
  admin: SupabaseClient,
  rawToken: string,
): Promise<VolunteerCollectionSessionRow | null> {
  const tokenHash = hashVolunteerSecret(rawToken.trim());
  const { data, error } = await admin
    .from(COLLECTION_TABLE)
    .select("*")
    .eq("session_token_hash", tokenHash)
    .maybeSingle();

  if (error) throw error;
  return data ? (data as VolunteerCollectionSessionRow) : null;
}

export async function resolveVolunteerCollectionSessionByToken(
  admin: SupabaseClient,
  rawToken: string,
): Promise<ResolveCollectionSessionResult> {
  const session = await fetchCollectionSessionByTokenHash(admin, rawToken);
  if (!session) return { ok: false, reason: "not_found" };

  if (session.status === "completed") {
    return { ok: false, reason: "completed" };
  }

  if (session.status === "expired") {
    return { ok: false, reason: "expired" };
  }

  if (session.status !== "active") {
    return { ok: false, reason: "inactive" };
  }

  if (isExpired(session.token_expires_at)) {
    await admin
      .from(COLLECTION_TABLE)
      .update({ status: "expired" })
      .eq("id", session.id)
      .eq("status", "active");
    return { ok: false, reason: "expired" };
  }

  return { ok: true, session };
}

/** Completion endpoint — completed sessions resolve for idempotent repeat calls. */
export async function resolveVolunteerCollectionSessionForCompletion(
  admin: SupabaseClient,
  rawToken: string,
): Promise<ResolveCollectionSessionResult> {
  const session = await fetchCollectionSessionByTokenHash(admin, rawToken);
  if (!session) return { ok: false, reason: "not_found" };

  if (session.status === "completed") {
    return { ok: true, session };
  }

  if (session.status === "expired") {
    return { ok: false, reason: "expired" };
  }

  if (session.status !== "active") {
    return { ok: false, reason: "inactive" };
  }

  if (isExpired(session.token_expires_at)) {
    await admin
      .from(COLLECTION_TABLE)
      .update({ status: "expired" })
      .eq("id", session.id)
      .eq("status", "active");
    return { ok: false, reason: "expired" };
  }

  return { ok: true, session };
}

export type CompleteCollectionSessionResult =
  | { ok: true; deletionCode: string }
  | { ok: true; alreadyCompleted: true };

export async function completeVolunteerCollectionSession(
  admin: SupabaseClient,
  session: VolunteerCollectionSessionRow,
): Promise<CompleteCollectionSessionResult> {
  if (session.status === "completed") {
    return { ok: true, alreadyCompleted: true };
  }

  const deletionCode = generateVolunteerDeletionCode();
  const deletionCodeHash = hashVolunteerSecret(deletionCode);
  const completedAt = new Date().toISOString();

  const { data, error } = await admin
    .from(COLLECTION_TABLE)
    .update({
      status: "completed",
      completed_at: completedAt,
      deletion_code_hash: deletionCodeHash,
    })
    .eq("id", session.id)
    .eq("status", "active")
    .select("id")
    .maybeSingle();

  if (error) throw error;
  if (!data) {
    const { data: latest, error: latestError } = await admin
      .from(COLLECTION_TABLE)
      .select("*")
      .eq("id", session.id)
      .maybeSingle();
    if (latestError) throw latestError;
    if (latest && (latest as VolunteerCollectionSessionRow).status === "completed") {
      return { ok: true, alreadyCompleted: true };
    }
    throw new Error("Unable to complete volunteer collection session.");
  }

  return { ok: true, deletionCode };
}

export type CreateMovementSessionInput = {
  movementType: VolunteerMovementType;
  protocolCondition: VolunteerProtocolCondition;
  side: VolunteerSide;
};

export type CreateMovementSessionResult = {
  movementSessionId: string;
  blockIndex: number;
};

export async function createVolunteerMovementSession(
  admin: SupabaseClient,
  collectionSessionId: string,
  input: CreateMovementSessionInput,
): Promise<CreateMovementSessionResult> {
  const { data: maxRow, error: maxError } = await admin
    .from(MOVEMENT_TABLE)
    .select("block_index")
    .eq("collection_session_id", collectionSessionId)
    .order("block_index", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (maxError) throw maxError;

  const nextBlockIndex = maxRow ? (maxRow as { block_index: number }).block_index + 1 : 1;

  const { data, error } = await admin
    .from(MOVEMENT_TABLE)
    .insert({
      collection_session_id: collectionSessionId,
      block_index: nextBlockIndex,
      movement_type: input.movementType,
      side: input.side,
      protocol_condition: input.protocolCondition,
    })
    .select("id, block_index")
    .single();

  if (error) throw error;

  return {
    movementSessionId: (data as { id: string }).id,
    blockIndex: (data as { block_index: number }).block_index,
  };
}

/** Test helper — inspect stored token hash without returning raw token from store. */
export async function getCollectionSessionTokenHashForTests(
  admin: SupabaseClient,
  rawToken: string,
): Promise<string | null> {
  const tokenHash = hashVolunteerSecret(rawToken);
  const { data, error } = await admin
    .from(COLLECTION_TABLE)
    .select("session_token_hash")
    .eq("session_token_hash", tokenHash)
    .maybeSingle();
  if (error) throw error;
  return data ? (data as { session_token_hash: string }).session_token_hash : null;
}

export { COLLECTION_TABLE, MOVEMENT_TABLE, VOLUNTEER_PROTOCOL_VERSION };
