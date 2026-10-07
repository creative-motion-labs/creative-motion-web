/**
 * Run: npx tsx --test app/api/research/volunteer/__tests__/volunteer-api.test.ts
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { hashVolunteerSecret } from "@/app/lib/research/volunteer-crypto";
import {
  VOLUNTEER_METADATA_BODY_MAX_BYTES,
  VOLUNTEER_NO_CACHE_HEADERS,
} from "@/app/lib/research/volunteer-api-guards";
import {
  hashVolunteerCampaignCodeForEnvSetup,
} from "@/app/lib/research/volunteer-campaign";
import {
  VOLUNTEER_CONSENT_VERSION,
  VOLUNTEER_PROTOCOL_VERSION,
  VOLUNTEER_SESSION_TOKEN_HEADER,
} from "@/app/lib/research/volunteer-constants";
import {
  COLLECTION_TABLE,
  MOVEMENT_TABLE,
  __setVolunteerServiceRoleClientForTests,
  type VolunteerCollectionSessionRow,
  type VolunteerMovementSessionRow,
} from "@/app/lib/research/volunteer-session-store";
import { POST as createSession } from "../sessions/route";
import { POST as createMovementSession } from "../movement-sessions/route";
import { PATCH as completeSession } from "../session/complete/route";

const FAKE_URL = "http://127.0.0.1:54321";
const FAKE_KEY = "test-fake-service-role-key";
const CAMPAIGN_CODE = "pilot-shared-code";

type CollectionRow = VolunteerCollectionSessionRow;
type MovementRow = VolunteerMovementSessionRow;

function makeIp(): string {
  return `10.8.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`;
}

function sessionCreateRequest(body: unknown, ip = makeIp()): NextRequest {
  const text = JSON.stringify(body);
  return new NextRequest("http://localhost/api/research/volunteer/sessions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "content-length": String(Buffer.byteLength(text)),
      "x-forwarded-for": ip,
    },
    body: text,
  });
}

function authedRequest(
  url: string,
  method: "POST" | "PATCH",
  token: string | null,
  body?: unknown,
): NextRequest {
  const headers: Record<string, string> = {
    "x-forwarded-for": makeIp(),
  };
  if (token) headers[VOLUNTEER_SESSION_TOKEN_HEADER] = token;
  if (body !== undefined) {
    const text = JSON.stringify(body);
    headers["content-type"] = "application/json";
    headers["content-length"] = String(Buffer.byteLength(text));
    return new NextRequest(url, { method, headers, body: text });
  }
  return new NextRequest(url, { method, headers });
}

function validCreateBody(overrides: Record<string, unknown> = {}) {
  return {
    campaignCode: CAMPAIGN_CODE,
    ageConfirmed18Plus: true,
    consentVersion: VOLUNTEER_CONSENT_VERSION,
    protocolVersion: VOLUNTEER_PROTOCOL_VERSION,
    ...overrides,
  };
}

function assertNoCacheHeaders(res: Response): void {
  for (const [name, value] of Object.entries(VOLUNTEER_NO_CACHE_HEADERS)) {
    assert.equal(res.headers.get(name), value, name);
  }
}

function createInMemoryVolunteerAdmin() {
  const collectionSessions: CollectionRow[] = [];
  const movementSessions: MovementRow[] = [];

  function findCollectionByHash(hash: string): CollectionRow | undefined {
    return collectionSessions.find((row) => row.session_token_hash === hash);
  }

  const client = {
    from(table: string) {
      if (table === COLLECTION_TABLE) {
        return {
          insert(row: Partial<CollectionRow>) {
            const inserted: CollectionRow = {
              id: crypto.randomUUID(),
              participant_id: row.participant_id!,
              session_token_hash: row.session_token_hash!,
              token_expires_at: row.token_expires_at!,
              status: row.status as CollectionRow["status"],
              age_confirmed_18_plus: row.age_confirmed_18_plus!,
              consent_version: row.consent_version!,
              consent_accepted_at_ms: row.consent_accepted_at_ms!,
              protocol_version: row.protocol_version!,
              deletion_code_hash: null,
              created_at: new Date().toISOString(),
              completed_at: null,
            };
            collectionSessions.push(inserted);
            return {
              then: (resolve: (v: { error: null }) => void) =>
                Promise.resolve({ error: null }).then(resolve),
            };
          },
          select() {
            return {
              eq(column: string, value: string) {
                return {
                  maybeSingle: async () => {
                    if (column === "session_token_hash") {
                      const row = findCollectionByHash(value);
                      return { data: row ?? null, error: null };
                    }
                    if (column === "id") {
                      const row = collectionSessions.find((r) => r.id === value);
                      return { data: row ?? null, error: null };
                    }
                    return { data: null, error: null };
                  },
                  single: async () => {
                    const row = collectionSessions.find((r) => r.id === value);
                    if (!row) return { data: null, error: { message: "not found" } };
                    return { data: row, error: null };
                  },
                };
              },
            };
          },
          update(patch: Partial<CollectionRow>) {
            const filters: Array<{ column: string; value: string }> = [];
            const chain = {
              eq(column: string, value: string) {
                filters.push({ column, value });
                return chain;
              },
              select() {
                return {
                  maybeSingle: async () => {
                    const row = collectionSessions.find((candidate) =>
                      filters.every((f) => (candidate as Record<string, unknown>)[f.column] === f.value),
                    );
                    if (!row) return { data: null, error: null };
                    Object.assign(row, patch);
                    return { data: { id: row.id }, error: null };
                  },
                };
              },
            };
            return chain;
          },
        };
      }

      if (table === MOVEMENT_TABLE) {
        return {
          select(columns: string) {
            return {
              eq(column: string, value: string) {
                return {
                  order(col: string, opts: { ascending: boolean }) {
                    return {
                      limit() {
                        return {
                          maybeSingle: async () => {
                            const rows = movementSessions
                              .filter((r) => (r as Record<string, unknown>)[column] === value)
                              .sort((a, b) =>
                                opts.ascending
                                  ? a.block_index - b.block_index
                                  : b.block_index - a.block_index,
                              );
                            const top = rows[0];
                            if (!top) return { data: null, error: null };
                            if (columns === "block_index") {
                              return { data: { block_index: top.block_index }, error: null };
                            }
                            return { data: top, error: null };
                          },
                        };
                      },
                    };
                  },
                };
              },
            };
          },
          insert(row: Partial<MovementRow>) {
            const collectionId = row.collection_session_id!;
            const blockIndex = row.block_index!;
            const duplicate = movementSessions.some(
              (r) =>
                r.collection_session_id === collectionId && r.block_index === blockIndex,
            );
            if (duplicate) {
              return {
                select() {
                  return {
                    single: async () => ({
                      data: null,
                      error: { code: "23505", message: "duplicate key value" },
                    }),
                  };
                },
              };
            }
            const inserted: MovementRow = {
              id: crypto.randomUUID(),
              collection_session_id: collectionId,
              block_index: blockIndex,
              movement_type: row.movement_type!,
              side: row.side!,
              protocol_condition: row.protocol_condition!,
              created_at: new Date().toISOString(),
            };
            movementSessions.push(inserted);
            return {
              select() {
                return {
                  single: async () => ({ data: inserted, error: null }),
                };
              },
            };
          },
        };
      }

      throw new Error(`unexpected table: ${table}`);
    },
    __collectionSessions: collectionSessions,
    __movementSessions: movementSessions,
  };

  return client as unknown as SupabaseClient & {
    __collectionSessions: CollectionRow[];
    __movementSessions: MovementRow[];
  };
}

describe("volunteer research API", { concurrency: 1 }, () => {
  let savedFlag: string | undefined;
  let savedHash: string | undefined;
  let savedUrl: string | undefined;
  let savedKey: string | undefined;
  let admin: ReturnType<typeof createInMemoryVolunteerAdmin>;

  before(() => {
    savedFlag = process.env.ML_VOLUNTEER_COLLECTION_ENABLED;
    savedHash = process.env.VOLUNTEER_CAMPAIGN_CODE_HASH;
    savedUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    savedKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    process.env.ML_VOLUNTEER_COLLECTION_ENABLED = "true";
    process.env.VOLUNTEER_CAMPAIGN_CODE_HASH = hashVolunteerCampaignCodeForEnvSetup(
      CAMPAIGN_CODE,
    );
    process.env.NEXT_PUBLIC_SUPABASE_URL = FAKE_URL;
    process.env.SUPABASE_SERVICE_ROLE_KEY = FAKE_KEY;

    admin = createInMemoryVolunteerAdmin();
    __setVolunteerServiceRoleClientForTests(admin);
  });

  after(() => {
    __setVolunteerServiceRoleClientForTests(null);
    if (savedFlag === undefined) delete process.env.ML_VOLUNTEER_COLLECTION_ENABLED;
    else process.env.ML_VOLUNTEER_COLLECTION_ENABLED = savedFlag;
    if (savedHash === undefined) delete process.env.VOLUNTEER_CAMPAIGN_CODE_HASH;
    else process.env.VOLUNTEER_CAMPAIGN_CODE_HASH = savedHash;
    if (savedUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = savedUrl;
    if (savedKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = savedKey;
  });

  it("returns 404 for all routes when feature flag is OFF", async () => {
    process.env.ML_VOLUNTEER_COLLECTION_ENABLED = "false";
    const createRes = await createSession(sessionCreateRequest(validCreateBody()));
    assert.equal(createRes.status, 404);
    const moveRes = await createMovementSession(
      authedRequest(
        "http://localhost/api/research/volunteer/movement-sessions",
        "POST",
        "token",
        { movementType: "shoulder_abduction_reach", protocolCondition: "NORMAL", side: "right" },
      ),
    );
    assert.equal(moveRes.status, 404);
    const completeRes = await completeSession(
      authedRequest("http://localhost/api/research/volunteer/session/complete", "PATCH", "token"),
    );
    assert.equal(completeRes.status, 404);
    const { POST: createRepetition } = await import("../repetitions/route");
    const repetitionRes = await createRepetition(
      authedRequest("http://localhost/api/research/volunteer/repetitions", "POST", "token", {}),
    );
    assert.equal(repetitionRes.status, 404);
    process.env.ML_VOLUNTEER_COLLECTION_ENABLED = "true";
  });

  it("rejects session create without campaign code", async () => {
    const res = await createSession(
      sessionCreateRequest(validCreateBody({ campaignCode: "" })),
    );
    assert.equal(res.status, 400);
  });

  it("rejects invalid campaign code with 404", async () => {
    const res = await createSession(
      sessionCreateRequest(validCreateBody({ campaignCode: "wrong" })),
    );
    assert.equal(res.status, 404);
  });

  it("rejects ageConfirmed18Plus false", async () => {
    const res = await createSession(
      sessionCreateRequest(validCreateBody({ ageConfirmed18Plus: false })),
    );
    assert.equal(res.status, 400);
  });

  it("creates session with token + expiresAt only", async () => {
    const res = await createSession(sessionCreateRequest(validCreateBody()));
    assert.equal(res.status, 200);
    assertNoCacheHeaders(res);
    const body = (await res.json()) as Record<string, unknown>;
    assert.ok(typeof body.sessionToken === "string");
    assert.ok(typeof body.expiresAt === "string");
    assert.equal(body.participant_id, undefined);
    assert.equal(body.collection_session_id, undefined);
    assert.equal(body.collectionSessionId, undefined);

    const stored = admin.__collectionSessions[0]!;
    assert.equal(stored.session_token_hash, hashVolunteerSecret(body.sessionToken as string));
    assert.notEqual(stored.session_token_hash, body.sessionToken);
  });

  it("rejects expired and completed tokens for movement session creation", async () => {
    const createRes = await createSession(sessionCreateRequest(validCreateBody()));
    const { sessionToken } = (await createRes.json()) as { sessionToken: string };
    const row = admin.__collectionSessions.find(
      (r) => r.session_token_hash === hashVolunteerSecret(sessionToken),
    )!;
    row.token_expires_at = new Date(Date.now() - 1_000).toISOString();

    const expiredRes = await createMovementSession(
      authedRequest(
        "http://localhost/api/research/volunteer/movement-sessions",
        "POST",
        sessionToken,
        {
          movementType: "shoulder_abduction_reach",
          protocolCondition: "NORMAL",
          side: "right",
        },
      ),
    );
    assert.equal(expiredRes.status, 404);

    row.token_expires_at = new Date(Date.now() + 60_000).toISOString();
    row.status = "completed";
    const completedRes = await createMovementSession(
      authedRequest(
        "http://localhost/api/research/volunteer/movement-sessions",
        "POST",
        sessionToken,
        {
          movementType: "shoulder_abduction_reach",
          protocolCondition: "NORMAL",
          side: "right",
        },
      ),
    );
    assert.equal(completedRes.status, 404);
  });

  it("creates movement sessions with server-assigned block_index", async () => {
    const createRes = await createSession(sessionCreateRequest(validCreateBody()));
    const { sessionToken } = (await createRes.json()) as { sessionToken: string };

    const first = await createMovementSession(
      authedRequest(
        "http://localhost/api/research/volunteer/movement-sessions",
        "POST",
        sessionToken,
        {
          movementType: "shoulder_abduction_reach",
          protocolCondition: "NORMAL",
          side: "right",
        },
      ),
    );
    assert.equal(first.status, 200);
    assertNoCacheHeaders(first);
    const firstBody = (await first.json()) as { movementSessionId: string; blockIndex: number };
    assert.equal(firstBody.blockIndex, 1);

    const second = await createMovementSession(
      authedRequest(
        "http://localhost/api/research/volunteer/movement-sessions",
        "POST",
        sessionToken,
        {
          movementType: "shoulder_abduction_reach",
          protocolCondition: "SIMULATED_MILD_COMPENSATION",
          side: "right",
        },
      ),
    );
    const secondBody = (await second.json()) as { blockIndex: number };
    assert.equal(secondBody.blockIndex, 2);
  });

  it("completes session token-only and returns deletion code once", async () => {
    const createRes = await createSession(sessionCreateRequest(validCreateBody()));
    const { sessionToken } = (await createRes.json()) as { sessionToken: string };

    const completeRes = await completeSession(
      authedRequest("http://localhost/api/research/volunteer/session/complete", "PATCH", sessionToken),
    );
    assert.equal(completeRes.status, 200);
    assertNoCacheHeaders(completeRes);
    const completeBody = (await completeRes.json()) as { ok: boolean; deletionCode: string };
    assert.equal(completeBody.ok, true);
    assert.match(completeBody.deletionCode, /^[2-9A-HJ-NP-Z]{4}-/);

    const row = admin.__collectionSessions.find(
      (r) => r.session_token_hash === hashVolunteerSecret(sessionToken),
    )!;
    assert.equal(row.status, "completed");
    assert.ok(row.deletion_code_hash);
    assert.notEqual(row.deletion_code_hash, completeBody.deletionCode);

    const repeatRes = await completeSession(
      authedRequest("http://localhost/api/research/volunteer/session/complete", "PATCH", sessionToken),
    );
    const repeatBody = (await repeatRes.json()) as { alreadyCompleted: boolean; deletionCode?: string };
    assert.equal(repeatBody.alreadyCompleted, true);
    assert.equal(repeatBody.deletionCode, undefined);
  });

  it("rejects client-supplied consentAcceptedAtMs", async () => {
    for (const forged of [0, 1, Date.now(), Date.now() + 60_000]) {
      const res = await createSession(
        sessionCreateRequest(validCreateBody({ consentAcceptedAtMs: forged })),
      );
      assert.equal(res.status, 400);
      assertNoCacheHeaders(res);
    }
  });

  it("rejects extra session-create fields", async () => {
    const res = await createSession(
      sessionCreateRequest(validCreateBody({ sessionToken: "forged-token" })),
    );
    assert.equal(res.status, 400);
    assertNoCacheHeaders(res);
  });

  it("rejects unsupported media type", async () => {
    const res = await createSession(
      new NextRequest("http://localhost/api/research/volunteer/sessions", {
        method: "POST",
        headers: {
          "content-type": "text/plain",
          "x-forwarded-for": makeIp(),
        },
        body: "plain",
      }),
    );
    assert.equal(res.status, 415);
    assertNoCacheHeaders(res);
  });

  it("accepts application/json with charset", async () => {
    const text = JSON.stringify(validCreateBody());
    const res = await createSession(
      new NextRequest("http://localhost/api/research/volunteer/sessions", {
        method: "POST",
        headers: {
          "content-type": "application/json; charset=utf-8",
          "content-length": String(Buffer.byteLength(text)),
          "x-forwarded-for": makeIp(),
        },
        body: text,
      }),
    );
    assert.equal(res.status, 200);
    assertNoCacheHeaders(res);
  });

  it("rejects malformed JSON", async () => {
    const body = "{not-json";
    const res = await createSession(
      new NextRequest("http://localhost/api/research/volunteer/sessions", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "content-length": String(Buffer.byteLength(body)),
          "x-forwarded-for": makeIp(),
        },
        body,
      }),
    );
    assert.equal(res.status, 400);
    assertNoCacheHeaders(res);
  });

  it("rejects oversized declared content-length", async () => {
    const res = await createSession(
      new NextRequest("http://localhost/api/research/volunteer/sessions", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "content-length": String(VOLUNTEER_METADATA_BODY_MAX_BYTES + 1),
          "x-forwarded-for": makeIp(),
        },
        body: JSON.stringify(validCreateBody()),
      }),
    );
    assert.equal(res.status, 413);
    assertNoCacheHeaders(res);
  });

  it("rejects oversized streamed body when content-length is absent", async () => {
    const padding = "x".repeat(VOLUNTEER_METADATA_BODY_MAX_BYTES);
    const body = JSON.stringify({ ...validCreateBody(), padding });
    const res = await createSession(
      new NextRequest("http://localhost/api/research/volunteer/sessions", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-forwarded-for": makeIp(),
        },
        body,
      }),
    );
    assert.equal(res.status, 413);
    assertNoCacheHeaders(res);
  });

  it("records consent timestamp server-side within the request window", async () => {
    const beforeMs = Date.now();
    const res = await createSession(sessionCreateRequest(validCreateBody()));
    const afterMs = Date.now();
    assert.equal(res.status, 200);

    const { sessionToken } = (await res.json()) as { sessionToken: string };
    const stored = admin.__collectionSessions.find(
      (row) => row.session_token_hash === hashVolunteerSecret(sessionToken),
    )!;
    const consentMs = Number(stored.consent_accepted_at_ms);
    assert.ok(consentMs >= beforeMs);
    assert.ok(consentMs <= afterMs);
  });
});
