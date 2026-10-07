/**
 * Run: npx tsx --test app/lib/research/volunteer-session-store.test.ts
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { hashVolunteerSecret } from "./volunteer-crypto";
import {
  COLLECTION_TABLE,
  MOVEMENT_TABLE,
  __setVolunteerServiceRoleClientForTests,
  completeVolunteerCollectionSession,
  createVolunteerCollectionSession,
  createVolunteerMovementSession,
  resolveVolunteerCollectionSessionByToken,
} from "./volunteer-session-store";
import { VOLUNTEER_PROTOCOL_VERSION } from "./volunteer-constants";

function createStoreMockAdmin() {
  const collection: Array<Record<string, unknown>> = [];
  const movement: Array<Record<string, unknown>> = [];

  const client = {
    from(table: string) {
      if (table === COLLECTION_TABLE) {
        return {
          insert(row: Record<string, unknown>) {
            const inserted = {
              id: crypto.randomUUID(),
              ...row,
              deletion_code_hash: null,
              created_at: new Date().toISOString(),
              completed_at: null,
            };
            collection.push(inserted);
            return { then: (resolve: (v: { error: null }) => void) => Promise.resolve({ error: null }).then(resolve) };
          },
          select() {
            return {
              eq(column: string, value: string) {
                return {
                  maybeSingle: async () => {
                    const row = collection.find((r) => r[column] === value);
                    return { data: row ?? null, error: null };
                  },
                };
              },
            };
          },
          update(patch: Record<string, unknown>) {
            const filters: Array<{ column: string; value: string }> = [];
            const chain = {
              eq(column: string, value: string) {
                filters.push({ column, value });
                return chain;
              },
              select() {
                return {
                  maybeSingle: async () => {
                    const row = collection.find((candidate) =>
                      filters.every((f) => candidate[f.column] === f.value),
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
          select() {
            return {
              eq(column: string, value: string) {
                return {
                  order() {
                    return {
                      limit() {
                        return {
                          maybeSingle: async () => {
                            const rows = movement
                              .filter((r) => r[column] === value)
                              .sort((a, b) => Number(b.block_index) - Number(a.block_index));
                            return { data: rows[0] ? { block_index: rows[0].block_index } : null, error: null };
                          },
                        };
                      },
                    };
                  },
                };
              },
            };
          },
          insert(row: Record<string, unknown>) {
            const inserted = { id: crypto.randomUUID(), ...row, created_at: new Date().toISOString() };
            movement.push(inserted);
            return {
              select() {
                return { single: async () => ({ data: inserted, error: null }) };
              },
            };
          },
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
    __collection: collection,
  };

  return client as unknown as SupabaseClient & { __collection: Array<Record<string, unknown>> };
}

describe("volunteer-session-store", { concurrency: 1 }, () => {
  let admin: ReturnType<typeof createStoreMockAdmin>;

  before(() => {
    admin = createStoreMockAdmin();
    __setVolunteerServiceRoleClientForTests(admin);
  });

  after(() => {
    __setVolunteerServiceRoleClientForTests(null);
  });

  it("stores only token hash, never raw token", async () => {
    const created = await createVolunteerCollectionSession(admin, {
      consentVersion: "volunteer-ml-capture-1.0",
      protocolVersion: VOLUNTEER_PROTOCOL_VERSION,
    });
    const row = admin.__collection[0]!;
    assert.equal(row.session_token_hash, hashVolunteerSecret(created.sessionToken));
    assert.notEqual(row.session_token_hash, created.sessionToken);
  });

  it("records consent acceptance timestamp server-side", async () => {
    const beforeMs = Date.now();
    const created = await createVolunteerCollectionSession(admin, {
      consentVersion: "volunteer-ml-capture-1.0",
      protocolVersion: VOLUNTEER_PROTOCOL_VERSION,
    });
    const afterMs = Date.now();
    const row = admin.__collection.find(
      (candidate) => candidate.session_token_hash === hashVolunteerSecret(created.sessionToken),
    )!;
    const stored = Number(row.consent_accepted_at_ms);
    assert.ok(Number.isFinite(stored));
    assert.ok(stored >= beforeMs);
    assert.ok(stored <= afterMs);
  });

  it("assigns incremental block_index values", async () => {
    const created = await createVolunteerCollectionSession(admin, {
      consentVersion: "volunteer-ml-capture-1.0",
      protocolVersion: VOLUNTEER_PROTOCOL_VERSION,
    });
    const resolved = await resolveVolunteerCollectionSessionByToken(admin, created.sessionToken);
    assert.equal(resolved.ok, true);
    if (!resolved.ok) return;

    const first = await createVolunteerMovementSession(admin, resolved.session.id, {
      movementType: "shoulder_abduction_reach",
      protocolCondition: "NORMAL",
      side: "right",
    });
    const second = await createVolunteerMovementSession(admin, resolved.session.id, {
      movementType: "shoulder_abduction_reach",
      protocolCondition: "SIMULATED_CLEAR_COMPENSATION",
      side: "right",
    });
    assert.equal(first.blockIndex, 1);
    assert.equal(second.blockIndex, 2);
  });

  it("stores deletion code hash only at completion", async () => {
    const created = await createVolunteerCollectionSession(admin, {
      consentVersion: "volunteer-ml-capture-1.0",
      protocolVersion: VOLUNTEER_PROTOCOL_VERSION,
    });
    const resolved = await resolveVolunteerCollectionSessionByToken(admin, created.sessionToken);
    assert.equal(resolved.ok, true);
    if (!resolved.ok) return;

    const completed = await completeVolunteerCollectionSession(admin, resolved.session);
    assert.equal("deletionCode" in completed, true);
    if (!("deletionCode" in completed)) return;

    const row = admin.__collection.find(
      (r) => r.session_token_hash === hashVolunteerSecret(created.sessionToken),
    )!;
    assert.equal(row.deletion_code_hash, hashVolunteerSecret(completed.deletionCode));
    assert.notEqual(row.deletion_code_hash, completed.deletionCode);
  });
});
