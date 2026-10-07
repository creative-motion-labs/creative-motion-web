/**
 * Run: npx tsx --test app/api/research/volunteer/__tests__/volunteer-repetitions-api.test.ts
 */
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { hashVolunteerCampaignCodeForEnvSetup } from "@/app/lib/research/volunteer-campaign";
import {
  VOLUNTEER_CONSENT_VERSION,
  VOLUNTEER_PROTOCOL_VERSION,
  VOLUNTEER_SESSION_TOKEN_HEADER,
} from "@/app/lib/research/volunteer-constants";
import { VOLUNTEER_NO_CACHE_HEADERS } from "@/app/lib/research/volunteer-api-guards";
import {
  buildVolunteerRepetitionFixture,
  hashVolunteerRepetitionPayload,
  VOLUNTEER_REPETITION_MAX_JSON_BYTES,
} from "@/app/lib/research/volunteer-repetition-validation";
import { REPETITION_TABLE } from "@/app/lib/research/volunteer-repetition-store";
import {
  COLLECTION_TABLE,
  MOVEMENT_TABLE,
  __setVolunteerServiceRoleClientForTests,
  type VolunteerCollectionSessionRow,
  type VolunteerMovementSessionRow,
} from "@/app/lib/research/volunteer-session-store";
import { POST as createSession } from "../sessions/route";
import { POST as createMovementSession } from "../movement-sessions/route";
import { POST as createRepetition } from "../repetitions/route";

const FAKE_URL = "http://127.0.0.1:54321";
const FAKE_KEY = "test-fake-service-role-key";
const CAMPAIGN_CODE = "pilot-shared-code";

type RepetitionRow = {
  id: string;
  movement_session_id: string;
  client_submission_id: string;
  payload_hash: string;
  frames?: unknown;
  derived_features?: unknown;
};

function authedPost(url: string, token: string | null, body?: unknown) {
  const headers: Record<string, string> = {
    "x-forwarded-for": `10.9.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`,
  };
  if (token) headers[VOLUNTEER_SESSION_TOKEN_HEADER] = token;
  if (body !== undefined) {
    const text = JSON.stringify(body);
    headers["content-type"] = "application/json";
    headers["content-length"] = String(Buffer.byteLength(text));
    return new NextRequest(url, { method: "POST", headers, body: text });
  }
  return new NextRequest(url, { method: "POST", headers });
}

function authedPostStream(
  url: string,
  token: string | null,
  bytes: Uint8Array,
  headers: Record<string, string> = {},
) {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
  const reqHeaders: Record<string, string> = {
    "x-forwarded-for": `10.9.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`,
    "content-type": "application/json",
    ...headers,
  };
  if (token) reqHeaders[VOLUNTEER_SESSION_TOKEN_HEADER] = token;
  return new NextRequest(url, {
    method: "POST",
    headers: reqHeaders,
    body: stream,
    duplex: "half",
  } as RequestInit);
}

function createVolunteerAdminWithRepetitions() {
  const collectionSessions: VolunteerCollectionSessionRow[] = [];
  const movementSessions: VolunteerMovementSessionRow[] = [];
  const repetitions: RepetitionRow[] = [];

  const client = {
    from(table: string) {
      if (table === COLLECTION_TABLE) {
        return {
          insert(row: Partial<VolunteerCollectionSessionRow>) {
            const inserted = {
              id: crypto.randomUUID(),
              participant_id: row.participant_id!,
              session_token_hash: row.session_token_hash!,
              token_expires_at: row.token_expires_at!,
              status: row.status as VolunteerCollectionSessionRow["status"],
              age_confirmed_18_plus: row.age_confirmed_18_plus!,
              consent_version: row.consent_version!,
              consent_accepted_at_ms: row.consent_accepted_at_ms!,
              protocol_version: row.protocol_version!,
              deletion_code_hash: null,
              created_at: new Date().toISOString(),
              completed_at: null,
            } satisfies VolunteerCollectionSessionRow;
            collectionSessions.push(inserted);
            return { then: (resolve: (v: { error: null }) => void) => Promise.resolve({ error: null }).then(resolve) };
          },
          select() {
            return {
              eq(column: string, value: string) {
                return {
                  maybeSingle: async () => {
                    if (column === "session_token_hash") {
                      const row = collectionSessions.find((r) => r.session_token_hash === value);
                      return { data: row ?? null, error: null };
                    }
                    return { data: null, error: null };
                  },
                };
              },
            };
          },
          update() {
            return { eq: () => ({ eq: () => ({ select: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }) };
          },
        };
      }

      if (table === MOVEMENT_TABLE) {
        return {
          select() {
            const filters: Array<{ column: string; value: string }> = [];
            const chain = {
              eq(column: string, value: string) {
                filters.push({ column, value });
                return chain;
              },
              order() {
                return {
                  limit() {
                    return {
                      maybeSingle: async () => {
                        const rows = movementSessions.filter((r) =>
                          filters.every((f) => (r as Record<string, unknown>)[f.column] === f.value),
                        );
                        const top = rows.sort((a, b) => b.block_index - a.block_index)[0];
                        return { data: top ? { block_index: top.block_index } : null, error: null };
                      },
                    };
                  },
                };
              },
              maybeSingle: async () => {
                const row = movementSessions.find((r) =>
                  filters.every((f) => (r as Record<string, unknown>)[f.column] === f.value),
                );
                return { data: row ?? null, error: null };
              },
            };
            return chain;
          },
          insert(row: Partial<VolunteerMovementSessionRow>) {
            const inserted: VolunteerMovementSessionRow = {
              id: crypto.randomUUID(),
              collection_session_id: row.collection_session_id!,
              block_index: row.block_index!,
              movement_type: row.movement_type!,
              side: row.side!,
              protocol_condition: row.protocol_condition!,
              created_at: new Date().toISOString(),
            };
            movementSessions.push(inserted);
            return { select: () => ({ single: async () => ({ data: inserted, error: null }) }) };
          },
        };
      }

      if (table === REPETITION_TABLE) {
        return {
          insert(row: {
            movement_session_id: string;
            client_submission_id: string;
            payload_hash: string;
            frames?: unknown;
            derived_features?: unknown;
          }) {
            const duplicate = repetitions.find(
              (r) =>
                r.movement_session_id === row.movement_session_id &&
                r.client_submission_id === row.client_submission_id,
            );
            if (duplicate) {
              return {
                select: () => ({
                  single: async () => ({ data: null, error: { code: "23505", message: "duplicate" } }),
                }),
              };
            }
            const inserted: RepetitionRow = {
              id: crypto.randomUUID(),
              movement_session_id: row.movement_session_id,
              client_submission_id: row.client_submission_id,
              payload_hash: row.payload_hash,
              frames: row.frames,
              derived_features: row.derived_features,
            };
            repetitions.push(inserted);
            return { select: () => ({ single: async () => ({ data: { id: inserted.id }, error: null }) }) };
          },
          select() {
            const filters: Array<{ column: string; value: string }> = [];
            const chain = {
              eq(column: string, value: string) {
                filters.push({ column, value });
                return chain;
              },
              maybeSingle: async () => {
                const row = repetitions.find((r) =>
                  filters.every((f) => (r as Record<string, unknown>)[f.column] === f.value),
                );
                return { data: row ?? null, error: null };
              },
            };
            return chain;
          },
        };
      }

      throw new Error(`unexpected table: ${table}`);
    },
    __movementSessions: movementSessions,
    __repetitions: repetitions,
  };

  return client as unknown as SupabaseClient & {
    __movementSessions: VolunteerMovementSessionRow[];
    __repetitions: RepetitionRow[];
  };
}

function assertNoCacheHeaders(res: Response): void {
  for (const [name, value] of Object.entries(VOLUNTEER_NO_CACHE_HEADERS)) {
    assert.equal(res.headers.get(name), value, name);
  }
}

async function createActiveSessionWithMovement() {
  const createRes = await createSession(
    authedPost("http://localhost/api/research/volunteer/sessions", null, {
      campaignCode: CAMPAIGN_CODE,
      ageConfirmed18Plus: true,
      consentVersion: VOLUNTEER_CONSENT_VERSION,
      protocolVersion: VOLUNTEER_PROTOCOL_VERSION,
    }),
  );
  const { sessionToken } = (await createRes.json()) as { sessionToken: string };
  const moveRes = await createMovementSession(
    authedPost("http://localhost/api/research/volunteer/movement-sessions", sessionToken, {
      movementType: "shoulder_abduction_reach",
      protocolCondition: "NORMAL",
      side: "right",
    }),
  );
  const { movementSessionId } = (await moveRes.json()) as { movementSessionId: string };
  return { sessionToken, movementSessionId };
}

describe("POST /api/research/volunteer/repetitions", { concurrency: 1 }, () => {
  before(() => {
    process.env.ML_VOLUNTEER_COLLECTION_ENABLED = "true";
    process.env.VOLUNTEER_CAMPAIGN_CODE_HASH = hashVolunteerCampaignCodeForEnvSetup(CAMPAIGN_CODE);
    process.env.NEXT_PUBLIC_SUPABASE_URL = FAKE_URL;
    process.env.SUPABASE_SERVICE_ROLE_KEY = FAKE_KEY;
  });

  after(() => {
    __setVolunteerServiceRoleClientForTests(null);
  });

  let admin: ReturnType<typeof createVolunteerAdminWithRepetitions>;

  beforeEach(() => {
    admin = createVolunteerAdminWithRepetitions();
    __setVolunteerServiceRoleClientForTests(admin);
  });

  it("returns 404 when feature flag is OFF", async () => {
    process.env.ML_VOLUNTEER_COLLECTION_ENABLED = "false";
    const res = await createRepetition(
      authedPost("http://localhost/api/research/volunteer/repetitions", "token", {}),
    );
    assert.equal(res.status, 404);
    assertNoCacheHeaders(res);
    process.env.ML_VOLUNTEER_COLLECTION_ENABLED = "true";
  });

  it("rejects client-supplied consentAcceptedAtMs during session setup", async () => {
    const res = await createSession(
      authedPost("http://localhost/api/research/volunteer/sessions", null, {
        campaignCode: CAMPAIGN_CODE,
        ageConfirmed18Plus: true,
        consentVersion: VOLUNTEER_CONSENT_VERSION,
        consentAcceptedAtMs: Date.now(),
        protocolVersion: VOLUNTEER_PROTOCOL_VERSION,
      }),
    );
    assert.equal(res.status, 400);
    assertNoCacheHeaders(res);
  });

  it("persists first submission and returns repetitionId only", async () => {
    const { sessionToken, movementSessionId } = await createActiveSessionWithMovement();
    const fixture = buildVolunteerRepetitionFixture({ movementSessionId });
    const res = await createRepetition(
      authedPost("http://localhost/api/research/volunteer/repetitions", sessionToken, {
        movementSessionId: fixture.movementSessionId,
        clientSubmissionId: fixture.clientSubmissionId,
        repetitionIndex: fixture.repetitionIndex,
        captureSchemaVersion: fixture.captureSchemaVersion,
        featureSchemaVersion: fixture.featureSchemaVersion,
        startedAtMs: fixture.startedAtMs,
        endedAtMs: fixture.endedAtMs,
        frames: fixture.frames,
        derivedFeatures: fixture.derivedFeatures,
      }),
    );
    assert.equal(res.status, 200);
    assertNoCacheHeaders(res);
    const body = (await res.json()) as { repetitionId: string; created: boolean };
    assert.equal(body.created, true);
    assert.ok(body.repetitionId);
    assert.equal((body as Record<string, unknown>).participant_id, undefined);
    assert.equal(admin.__repetitions.length, 1);
  });

  it("returns duplicate-safe success for same clientSubmissionId and payload", async () => {
    const { sessionToken, movementSessionId } = await createActiveSessionWithMovement();
    const fixture = buildVolunteerRepetitionFixture({ movementSessionId });
    const payload = {
      movementSessionId: fixture.movementSessionId,
      clientSubmissionId: fixture.clientSubmissionId,
      repetitionIndex: fixture.repetitionIndex,
      captureSchemaVersion: fixture.captureSchemaVersion,
      featureSchemaVersion: fixture.featureSchemaVersion,
      startedAtMs: fixture.startedAtMs,
      endedAtMs: fixture.endedAtMs,
      frames: fixture.frames,
      derivedFeatures: fixture.derivedFeatures,
    };
    const first = await createRepetition(
      authedPost("http://localhost/api/research/volunteer/repetitions", sessionToken, payload),
    );
    const second = await createRepetition(
      authedPost("http://localhost/api/research/volunteer/repetitions", sessionToken, payload),
    );
    const firstBody = (await first.json()) as { repetitionId: string; created: boolean };
    const secondBody = (await second.json()) as { repetitionId: string; created: boolean };
    assert.equal(firstBody.created, true);
    assert.equal(secondBody.created, false);
    assert.equal(firstBody.repetitionId, secondBody.repetitionId);
    assert.equal(admin.__repetitions.length, 1);
  });

  it("returns 409 when clientSubmissionId is reused with different payload", async () => {
    const { sessionToken, movementSessionId } = await createActiveSessionWithMovement();
    const fixture = buildVolunteerRepetitionFixture({ movementSessionId });
    const base = {
      movementSessionId: fixture.movementSessionId,
      clientSubmissionId: fixture.clientSubmissionId,
      repetitionIndex: fixture.repetitionIndex,
      captureSchemaVersion: fixture.captureSchemaVersion,
      featureSchemaVersion: fixture.featureSchemaVersion,
      startedAtMs: fixture.startedAtMs,
      endedAtMs: fixture.endedAtMs,
      frames: fixture.frames,
      derivedFeatures: fixture.derivedFeatures,
    };
    await createRepetition(
      authedPost("http://localhost/api/research/volunteer/repetitions", sessionToken, base),
    );
    const conflict = await createRepetition(
      authedPost("http://localhost/api/research/volunteer/repetitions", sessionToken, {
        ...base,
        repetitionIndex: 2,
      }),
    );
    assert.equal(conflict.status, 409);
    assertNoCacheHeaders(conflict);
  });

  it("returns 404 when movement session is not owned by authenticated collection session", async () => {
    const { sessionToken } = await createActiveSessionWithMovement();
    const foreignMovementId = crypto.randomUUID();
    const fixture = buildVolunteerRepetitionFixture({ movementSessionId: foreignMovementId });
    const res = await createRepetition(
      authedPost("http://localhost/api/research/volunteer/repetitions", sessionToken, {
        movementSessionId: fixture.movementSessionId,
        clientSubmissionId: fixture.clientSubmissionId,
        repetitionIndex: fixture.repetitionIndex,
        captureSchemaVersion: fixture.captureSchemaVersion,
        featureSchemaVersion: fixture.featureSchemaVersion,
        startedAtMs: fixture.startedAtMs,
        endedAtMs: fixture.endedAtMs,
        frames: fixture.frames,
        derivedFeatures: fixture.derivedFeatures,
      }),
    );
    assert.equal(res.status, 404);
  });

  it("stores payload hash not raw frames in mock row", async () => {
    const { sessionToken, movementSessionId } = await createActiveSessionWithMovement();
    const fixture = buildVolunteerRepetitionFixture({ movementSessionId });
    await createRepetition(
      authedPost("http://localhost/api/research/volunteer/repetitions", sessionToken, {
        movementSessionId: fixture.movementSessionId,
        clientSubmissionId: fixture.clientSubmissionId,
        repetitionIndex: fixture.repetitionIndex,
        captureSchemaVersion: fixture.captureSchemaVersion,
        featureSchemaVersion: fixture.featureSchemaVersion,
        startedAtMs: fixture.startedAtMs,
        endedAtMs: fixture.endedAtMs,
        frames: fixture.frames,
        derivedFeatures: fixture.derivedFeatures,
      }),
    );
    const row = admin.__repetitions[admin.__repetitions.length - 1]!;
    assert.equal(row.payload_hash, hashVolunteerRepetitionPayload(fixture));
  });

  it("returns 413 when Content-Length exceeds the cap", async () => {
    const { sessionToken } = await createActiveSessionWithMovement();
    const res = await createRepetition(
      authedPostStream(
        "http://localhost/api/research/volunteer/repetitions",
        sessionToken,
        Buffer.from("{}", "utf8"),
        { "content-length": String(VOLUNTEER_REPETITION_MAX_JSON_BYTES + 1) },
      ),
    );
    assert.equal(res.status, 413);
    assertNoCacheHeaders(res);
  });

  it("returns 413 for oversized streamed body without Content-Length", async () => {
    const { sessionToken } = await createActiveSessionWithMovement();
    const oversized = Buffer.alloc(VOLUNTEER_REPETITION_MAX_JSON_BYTES + 1, 0x41);
    const res = await createRepetition(
      authedPostStream(
        "http://localhost/api/research/volunteer/repetitions",
        sessionToken,
        oversized,
      ),
    );
    assert.equal(res.status, 413);
    assertNoCacheHeaders(res);
  });

  it("returns 400 for malformed JSON body", async () => {
    const { sessionToken } = await createActiveSessionWithMovement();
    const res = await createRepetition(
      authedPostStream(
        "http://localhost/api/research/volunteer/repetitions",
        sessionToken,
        Buffer.from("{not-json", "utf8"),
      ),
    );
    assert.equal(res.status, 400);
    assertNoCacheHeaders(res);
  });

  it("rejects extra top-level fields without persisting a row", async () => {
    const { sessionToken, movementSessionId } = await createActiveSessionWithMovement();
    const fixture = buildVolunteerRepetitionFixture({ movementSessionId });
    const res = await createRepetition(
      authedPost("http://localhost/api/research/volunteer/repetitions", sessionToken, {
        movementSessionId: fixture.movementSessionId,
        clientSubmissionId: fixture.clientSubmissionId,
        repetitionIndex: fixture.repetitionIndex,
        captureSchemaVersion: fixture.captureSchemaVersion,
        featureSchemaVersion: fixture.featureSchemaVersion,
        startedAtMs: fixture.startedAtMs,
        endedAtMs: fixture.endedAtMs,
        frames: fixture.frames,
        derivedFeatures: fixture.derivedFeatures,
        unexpectedField: "forged",
      }),
    );
    assert.equal(res.status, 400);
    assertNoCacheHeaders(res);
    assert.equal(admin.__repetitions.length, 0);
  });

  it("accepts valid JSON streamed without Content-Length", async () => {
    const { sessionToken, movementSessionId } = await createActiveSessionWithMovement();
    const fixture = buildVolunteerRepetitionFixture({ movementSessionId });
    const payload = {
      movementSessionId: fixture.movementSessionId,
      clientSubmissionId: fixture.clientSubmissionId,
      repetitionIndex: fixture.repetitionIndex,
      captureSchemaVersion: fixture.captureSchemaVersion,
      featureSchemaVersion: fixture.featureSchemaVersion,
      startedAtMs: fixture.startedAtMs,
      endedAtMs: fixture.endedAtMs,
      frames: fixture.frames,
      derivedFeatures: fixture.derivedFeatures,
    };
    const res = await createRepetition(
      authedPostStream(
        "http://localhost/api/research/volunteer/repetitions",
        sessionToken,
        Buffer.from(JSON.stringify(payload), "utf8"),
      ),
    );
    assert.equal(res.status, 200);
  });

  it("persists sanitized frames and derived features without injected properties", async () => {
    const { sessionToken, movementSessionId } = await createActiveSessionWithMovement();
    const fixture = buildVolunteerRepetitionFixture({ movementSessionId });
    const frame = fixture.frames[0]!;
    const payload = {
      movementSessionId: fixture.movementSessionId,
      clientSubmissionId: fixture.clientSubmissionId,
      repetitionIndex: fixture.repetitionIndex,
      captureSchemaVersion: fixture.captureSchemaVersion,
      featureSchemaVersion: fixture.featureSchemaVersion,
      startedAtMs: fixture.startedAtMs,
      endedAtMs: fixture.endedAtMs,
      frames: fixture.frames,
      derivedFeatures: fixture.derivedFeatures,
    };
    const res = await createRepetition(
      authedPost("http://localhost/api/research/volunteer/repetitions", sessionToken, payload),
    );
    assert.equal(res.status, 200);
    const row = admin.__repetitions[admin.__repetitions.length - 1]!;
    const storedFrame = (row.frames as typeof fixture.frames)[0]!;
    assert.deepEqual(Object.keys(storedFrame).sort(), ["frameIndex", "joints", "relativeTimestampMs"]);
    const storedJoint = storedFrame.joints.right_shoulder!;
    assert.deepEqual(Object.keys(storedJoint).sort(), ["confidence", "landmark"]);
    assert.deepEqual(Object.keys(storedJoint.landmark).sort(), ["x", "y"]);
    const storedDerived = row.derived_features as typeof fixture.derivedFeatures;
    assert.deepEqual(
      Object.keys(storedDerived).sort(),
      [
        "movementDurationMs",
        "peakAngularVelocityDegPerSec",
        "peakNormalizedTrunkDriftRatio",
        "peakShoulderAngleDegrees",
        "trackingQuality",
      ],
    );
    assert.equal((storedFrame as { injected?: unknown }).injected, undefined);
    assert.equal((storedJoint as { injected?: unknown }).injected, undefined);
    assert.equal((storedDerived as { injected?: unknown }).injected, undefined);
    assert.equal(frame.relativeTimestampMs, storedFrame.relativeTimestampMs);
  });
});
