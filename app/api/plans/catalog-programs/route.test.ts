/**
 * Run: npx tsx --test app/api/plans/catalog-programs/route.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CATALOG_PROGRAMS_NO_STORE_HEADERS,
  createCatalogProgramsGetHandler,
} from "./route";

const PROVIDER_ID = "11111111-1111-1111-1111-111111111111";
const PROGRAM_ID = "33333333-3333-3333-3333-333333333333";

function assertNoStoreHeaders(res: Response): void {
  assert.equal(res.headers.get("Cache-Control"), CATALOG_PROGRAMS_NO_STORE_HEADERS["Cache-Control"]);
  assert.equal(res.headers.get("Pragma"), CATALOG_PROGRAMS_NO_STORE_HEADERS.Pragma);
}

describe("GET /api/plans/catalog-programs", () => {
  it("17. unauthenticated response is 401 and non-cacheable before service-role data loading", async () => {
    let adminCalled = false;
    const handler = createCatalogProgramsGetHandler({
      buildClients: async () => ({
        sessionClient: {
          auth: {
            getUser: async () => ({ data: { user: null }, error: null }),
          },
        },
        adminClient: {
          from() {
            adminCalled = true;
            return {
              select() {
                return {
                  eq() {
                    return {
                      order: async () => ({ data: [], error: null }),
                    };
                  },
                };
              },
            };
          },
        },
      }),
      loadCatalogProgram: async () => {
        throw new Error("should not load programs when unauthenticated");
      },
    });

    const res = await handler();
    assert.equal(res.status, 401);
    assertNoStoreHeaders(res);
    assert.equal(adminCalled, false);
    const body = (await res.json()) as { error?: string };
    assert.equal(body.error, "Unauthorized.");
  });

  it("18. successful catalog GET is non-cacheable and returns only minimized fields", async () => {
    const handler = createCatalogProgramsGetHandler({
      buildClients: async () => ({
        sessionClient: {
          auth: {
            getUser: async () => ({ data: { user: { id: PROVIDER_ID } }, error: null }),
          },
        },
        adminClient: {
          from() {
            return {
              select() {
                return {
                  eq() {
                    return {
                      order: async () => ({ data: [{ id: PROGRAM_ID }], error: null }),
                    };
                  },
                };
              },
            };
          },
        },
      }),
      loadCatalogProgram: async () => ({
        sourceTreatmentProgramId: PROGRAM_ID,
        name: "Shoulder Foundation",
        slug: "shoulder-foundation",
        sessions: [
          {
            sessionNumber: 1,
            title: "Session 1",
            blocks: [{ movementId: "shoulder-abduction-reach" }],
          },
        ],
      }),
    });

    const res = await handler();
    assert.equal(res.status, 200);
    assertNoStoreHeaders(res);
    const body = (await res.json()) as {
      programs: Array<Record<string, unknown>>;
    };
    assert.equal(body.programs.length, 1);
    const program = body.programs[0]!;
    assert.deepEqual(Object.keys(program).sort(), ["id", "name", "sessions", "slug"]);
    const session = program.sessions as Array<Record<string, unknown>>;
    assert.equal(session.length, 1);
    assert.deepEqual(Object.keys(session[0]!).sort(), [
      "blocks",
      "requiresPrescribedSide",
      "sessionNumber",
      "title",
    ]);
    assert.equal("providerId" in program, false);
    assert.equal("created_at" in program, false);
  });
});
