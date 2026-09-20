#!/usr/bin/env -S npx tsx
/**
 * Volunteer Research Slice 8B.1 — Staging smoke harness.
 *
 * QA utility only — not production application code.
 *
 * Run from repository root:
 *   $env:VOLUNTEER_QA_CONFIRM_STAGING = "true"
 *   $env:VOLUNTEER_QA_CAMPAIGN_CODE = "<pilot-campaign-code>"
 *   npx tsx scripts/qa/volunteer-8b1-staging-smoke.mjs
 *
 * Optional Slice 8B.2 repetition live QA (requires Migration 022 on Staging):
 *   $env:VOLUNTEER_QA_RUN_REPETITIONS = "true"
 *
 * See scripts/qa/README.md for prerequisites and safety notes.
 */
import { createRequire } from "node:module";
import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  VOLUNTEER_CONSENT_VERSION,
  VOLUNTEER_PROTOCOL_VERSION,
  VOLUNTEER_PROTOCOL_CONDITIONS,
  VOLUNTEER_MOVEMENT_TYPES,
  VOLUNTEER_PILOT_SIDE,
  VOLUNTEER_SESSION_TOKEN_HEADER,
  VOLUNTEER_SESSION_TTL_MS,
} from "../../app/lib/research/volunteer-constants.ts";
import { hashVolunteerSecret } from "../../app/lib/research/volunteer-crypto.ts";
import { verifyVolunteerCampaignCode } from "../../app/lib/research/volunteer-campaign.ts";
import {
  COLLECTION_TABLE,
  MOVEMENT_TABLE,
} from "../../app/lib/research/volunteer-session-store.ts";
import {
  buildVolunteerRepetitionFixture,
  hashVolunteerRepetitionPayload,
} from "../../app/lib/research/volunteer-repetition-validation.ts";
import { REPETITION_TABLE } from "../../app/lib/research/volunteer-repetition-store.ts";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(resolve(REPO_ROOT, "package.json"));
const { createClient } = require("@supabase/supabase-js");

const BASE_URL = process.env.VOLUNTEER_QA_BASE_URL ?? "http://localhost:3000";
const MOVEMENT_TYPE = VOLUNTEER_MOVEMENT_TYPES[0];
const INVALID_MOVEMENT_TYPE_GUESS = "shoulder_abduction";
const INVALID_PROTOCOL_GUESS = "normal";

/** @typedef {"PASS" | "FAIL" | "SKIP"} QaStatus */

/** @type {Array<{ name: string; status: QaStatus; expected: string; actual: string; note?: string }>} */
const results = [];

/**
 * @param {string} name
 * @param {QaStatus} status
 * @param {string} expected
 * @param {string} actual
 * @param {string} [note]
 */
function record(name, status, expected, actual, note = "") {
  results.push({ name, status, expected, actual: redact(actual), note });
  console.log(`[${status}] ${name}${note ? ` — ${note}` : ""}`);
}

/** @param {unknown} value */
function redact(value) {
  const text = String(value ?? "");
  return text
    .replace(/[A-Za-z0-9_-]{20,}/g, "[redacted-token]")
    .replace(/\b[0-9a-f]{64}\b/gi, "[redacted-hash]")
    .replace(/\b[2-9A-HJ-NP-Z]{4}(?:-[2-9A-HJ-NP-Z]{4}){3}\b/g, "[redacted-deletion-code]");
}

function loadEnvLocalMissingOnly() {
  const path = resolve(REPO_ROOT, ".env.local");
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    if (!line || line.startsWith("#")) continue;
    const idx = line.indexOf("=");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    if (key === "VOLUNTEER_QA_CAMPAIGN_CODE") continue;
    let val = line.slice(idx + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
}

function assertProductionSafe() {
  if (process.env.VERCEL_ENV === "production") {
    console.error("Refusing to run: VERCEL_ENV=production");
    process.exit(2);
  }
  if (process.env.VOLUNTEER_QA_CONFIRM_STAGING !== "true") {
    console.error(
      "Refusing to run: set VOLUNTEER_QA_CONFIRM_STAGING=true after confirming Staging/local target (not Production).",
    );
    process.exit(2);
  }
}

function assertRequiredConfig() {
  const missing = [];
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) missing.push("NEXT_PUBLIC_SUPABASE_URL");
  if (!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) missing.push("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) missing.push("SUPABASE_SERVICE_ROLE_KEY");
  if (process.env.ML_VOLUNTEER_COLLECTION_ENABLED !== "true") {
    missing.push("ML_VOLUNTEER_COLLECTION_ENABLED=true");
  }
  if (!process.env.VOLUNTEER_CAMPAIGN_CODE_HASH?.trim()) {
    missing.push("VOLUNTEER_CAMPAIGN_CODE_HASH");
  }
  const campaignCode = process.env.VOLUNTEER_QA_CAMPAIGN_CODE?.trim();
  if (!campaignCode) {
    missing.push("VOLUNTEER_QA_CAMPAIGN_CODE (operator shell only)");
  } else if (!verifyVolunteerCampaignCode(campaignCode)) {
    console.error(
      "VOLUNTEER_QA_CAMPAIGN_CODE does not match VOLUNTEER_CAMPAIGN_CODE_HASH in .env.local (restart dev server after hash changes).",
    );
    process.exit(2);
  }
  if (missing.length) {
    console.error(`Missing required QA configuration: ${missing.join(", ")}`);
    process.exit(2);
  }
}

/**
 * @param {string} method
 * @param {string} path
 * @param {{ body?: unknown; token?: string }} [opts]
 */
async function http(method, path, opts = {}) {
  const headers = { "content-type": "application/json" };
  if (opts.token) headers[VOLUNTEER_SESSION_TOKEN_HEADER] = opts.token;
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  let json = null;
  const text = await res.text();
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: res.status, json };
}

/** @param {string} campaignCode */
function validSessionBody(campaignCode) {
  return {
    campaignCode,
    ageConfirmed18Plus: true,
    consentVersion: VOLUNTEER_CONSENT_VERSION,
    protocolVersion: VOLUNTEER_PROTOCOL_VERSION,
  };
}

/** @param {string} protocolCondition */
function validMovementBody(protocolCondition) {
  return {
    movementType: MOVEMENT_TYPE,
    protocolCondition,
    side: VOLUNTEER_PILOT_SIDE,
  };
}

/** @param {Record<string, unknown> | null | undefined} obj @param {string[]} allowedKeys */
function assertShape(obj, allowedKeys) {
  const keys = Object.keys(obj ?? {}).sort();
  const allowed = [...allowedKeys].sort();
  return JSON.stringify(keys) === JSON.stringify(allowed);
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} admin
 * @param {string | null} collectionSessionId
 * @param {string | null} repetitionMovementSessionId
 */
async function cleanupQaRows(admin, collectionSessionId, repetitionMovementSessionId) {
  if (!collectionSessionId || process.env.VOLUNTEER_QA_SKIP_CLEANUP === "true") {
    record(
      "Cleanup QA rows",
      "SKIP",
      "delete test session + movement rows",
      process.env.VOLUNTEER_QA_SKIP_CLEANUP === "true" ? "VOLUNTEER_QA_SKIP_CLEANUP=true" : "no session id",
    );
    return;
  }

  // Repetition rows must be deleted before their parent movement session row —
  // migration 022's FK is ON DELETE RESTRICT, so movement cleanup would fail otherwise.
  let repErr = null;
  if (repetitionMovementSessionId) {
    const { error } = await admin
      .from(REPETITION_TABLE)
      .delete()
      .eq("movement_session_id", repetitionMovementSessionId);
    repErr = error;
  }

  const { error: moveErr } = await admin
    .from(MOVEMENT_TABLE)
    .delete()
    .eq("collection_session_id", collectionSessionId);
  const { error: collErr } = await admin
    .from(COLLECTION_TABLE)
    .delete()
    .eq("id", collectionSessionId);

  const ok = !repErr && !moveErr && !collErr;
  record(
    "Cleanup QA rows",
    ok ? "PASS" : "FAIL",
    "delete test session + movement rows",
    ok ? "deleted" : repErr?.code ?? moveErr?.code ?? collErr?.code ?? "error",
    ok ? "" : "Rows may remain on Staging; inspect manually",
  );

  if (repetitionMovementSessionId) {
    const { data: residue, error: residueErr } = await admin
      .from(REPETITION_TABLE)
      .select("id")
      .eq("movement_session_id", repetitionMovementSessionId)
      .limit(1);
    const noResidue = !residueErr && (residue?.length ?? 0) === 0;
    record(
      "Repetition cleanup leaves no residue",
      noResidue ? "PASS" : "FAIL",
      "0 repetition rows remain",
      residueErr ? residueErr.code ?? "error" : `${residue?.length ?? 0} rows`,
    );
  }
}

async function main() {
  loadEnvLocalMissingOnly();
  assertProductionSafe();
  assertRequiredConfig();

  const campaignCode = process.env.VOLUNTEER_QA_CAMPAIGN_CODE.trim();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const svc = process.env.SUPABASE_SERVICE_ROLE_KEY;

  const admin = createClient(url, svc, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const anonClient = createClient(url, anon, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  /** @type {string | null} */
  let sessionToken = null;
  /** @type {string | null} */
  let collectionSessionId = null;
  /** @type {string | null} */
  let repetitionMovementSessionId = null;

  try {
    record(
      "Feature flag enabled for staging QA",
      process.env.ML_VOLUNTEER_COLLECTION_ENABLED === "true" ? "PASS" : "FAIL",
      "ML_VOLUNTEER_COLLECTION_ENABLED=true",
      `ML_VOLUNTEER_COLLECTION_ENABLED=${process.env.ML_VOLUNTEER_COLLECTION_ENABLED ?? "(unset)"}`,
    );

    const missingCampaign = await http("POST", "/api/research/volunteer/sessions", { body: {} });
    record(
      "Session create missing campaign",
      missingCampaign.status === 400 ? "PASS" : "FAIL",
      "400",
      String(missingCampaign.status),
    );

    const badCampaign = await http("POST", "/api/research/volunteer/sessions", {
      body: validSessionBody("definitely-wrong-campaign-code-for-qa"),
    });
    record(
      "Session create invalid campaign",
      badCampaign.status === 404 ? "PASS" : "FAIL",
      "404",
      String(badCampaign.status),
    );

    const badAge = await http("POST", "/api/research/volunteer/sessions", {
      body: { ...validSessionBody(campaignCode), ageConfirmed18Plus: false },
    });
    record(
      "Session create ageConfirmed18Plus false",
      badAge.status === 400 ? "PASS" : "FAIL",
      "400",
      String(badAge.status),
    );

    const badConsent = await http("POST", "/api/research/volunteer/sessions", {
      body: { ...validSessionBody(campaignCode), consentVersion: "wrong-consent-version" },
    });
    record(
      "Session create invalid consent version",
      badConsent.status === 400 ? "PASS" : "FAIL",
      "400",
      String(badConsent.status),
    );

    const badProtocolVersion = await http("POST", "/api/research/volunteer/sessions", {
      body: { ...validSessionBody(campaignCode), protocolVersion: "wrong-protocol-version" },
    });
    record(
      "Session create invalid protocol version",
      badProtocolVersion.status === 400 ? "PASS" : "FAIL",
      "400",
      String(badProtocolVersion.status),
    );

    const badTokenMove = await http("POST", "/api/research/volunteer/movement-sessions", {
      token: "not-a-real-volunteer-session-token",
      body: validMovementBody(VOLUNTEER_PROTOCOL_CONDITIONS[0]),
    });
    record(
      "Movement invalid session token",
      badTokenMove.status === 404 ? "PASS" : "FAIL",
      "404",
      String(badTokenMove.status),
    );

    const anonSelectCollection = await anonClient.from(COLLECTION_TABLE).select("id").limit(1);
    record(
      "Anon cannot read collection sessions",
      anonSelectCollection.error ? "PASS" : "FAIL",
      "permission denied",
      anonSelectCollection.error?.code ?? "no-error",
    );

    const anonInsertCollection = await anonClient.from(COLLECTION_TABLE).insert({
      participant_id: crypto.randomUUID(),
      session_token_hash: hashVolunteerSecret("qa-anon-insert-probe"),
      token_expires_at: new Date(Date.now() + 3_600_000).toISOString(),
      status: "active",
      age_confirmed_18_plus: true,
      consent_version: VOLUNTEER_CONSENT_VERSION,
      consent_accepted_at_ms: Date.now(),
      protocol_version: VOLUNTEER_PROTOCOL_VERSION,
    });
    record(
      "Anon cannot write collection sessions",
      anonInsertCollection.error ? "PASS" : "FAIL",
      "permission denied",
      anonInsertCollection.error?.code ?? "no-error",
    );

    const created = await http("POST", "/api/research/volunteer/sessions", {
      body: validSessionBody(campaignCode),
    });
    const shapeOk =
      created.status === 200 && assertShape(created.json, ["sessionToken", "expiresAt"]);
    record(
      "Session create valid payload",
      shapeOk ? "PASS" : "FAIL",
      "200 + {sessionToken, expiresAt}",
      `${created.status} keys=${Object.keys(created.json ?? {}).join(",")}`,
    );

    const tokenLenOk =
      typeof created.json?.sessionToken === "string" &&
      Buffer.from(created.json.sessionToken, "base64url").length >= 32;
    record(
      "Session token entropy",
      tokenLenOk ? "PASS" : "FAIL",
      ">=32 bytes base64url",
      tokenLenOk ? "ok" : "short/invalid",
    );

    const expiresAtMs = Date.parse(created.json?.expiresAt ?? "");
    const ttlMs = expiresAtMs - Date.now();
    record(
      "Session expiry ~4h",
      ttlMs > 3.5 * 60 * 60 * 1000 && ttlMs <= VOLUNTEER_SESSION_TTL_MS + 60_000 ? "PASS" : "FAIL",
      "~14400000ms remaining",
      `${Math.round(ttlMs)}ms`,
    );

    sessionToken = typeof created.json?.sessionToken === "string" ? created.json.sessionToken : null;
    if (!sessionToken) {
      record("Movement/complete flow", "FAIL", "session token from create", "missing", "Cannot continue");
      return;
    }

    const { data: row } = await admin
      .from(COLLECTION_TABLE)
      .select("id, session_token_hash, deletion_code_hash, status, participant_id")
      .eq("session_token_hash", hashVolunteerSecret(sessionToken))
      .maybeSingle();
    collectionSessionId = row?.id ?? null;

    record(
      "DB stores hash not raw session token",
      row && row.session_token_hash === hashVolunteerSecret(sessionToken) ? "PASS" : "FAIL",
      "hash match",
      row ? "hash-match" : "row-missing",
    );
    record(
      "DB row has no deletion hash at create",
      row?.deletion_code_hash == null ? "PASS" : "FAIL",
      "null",
      String(row?.deletion_code_hash ?? "null"),
    );
    record(
      "Response omits participant/collection ids",
      !created.json?.participant_id && !created.json?.collectionSessionId ? "PASS" : "FAIL",
      "absent",
      created.json?.participant_id ?? created.json?.collectionSessionId ?? "absent",
    );
    record(
      "DB participant_id is server-minted uuid",
      row?.participant_id ? "PASS" : "FAIL",
      "uuid present",
      row?.participant_id ? "present" : "missing",
    );

    const badMovementType = await http("POST", "/api/research/volunteer/movement-sessions", {
      token: sessionToken,
      body: {
        movementType: INVALID_MOVEMENT_TYPE_GUESS,
        protocolCondition: VOLUNTEER_PROTOCOL_CONDITIONS[0],
        side: VOLUNTEER_PILOT_SIDE,
      },
    });
    record(
      "Movement rejects invalid movementType",
      badMovementType.status === 400 ? "PASS" : "FAIL",
      "400",
      `${badMovementType.status} ${badMovementType.json?.error ?? ""}`,
    );

    const badProtocol = await http("POST", "/api/research/volunteer/movement-sessions", {
      token: sessionToken,
      body: {
        movementType: MOVEMENT_TYPE,
        protocolCondition: INVALID_PROTOCOL_GUESS,
        side: VOLUNTEER_PILOT_SIDE,
      },
    });
    record(
      "Movement rejects invalid protocolCondition casing",
      badProtocol.status === 400 ? "PASS" : "FAIL",
      "400",
      `${badProtocol.status} ${badProtocol.json?.error ?? ""}`,
    );

    const badSide = await http("POST", "/api/research/volunteer/movement-sessions", {
      token: sessionToken,
      body: {
        movementType: MOVEMENT_TYPE,
        protocolCondition: VOLUNTEER_PROTOCOL_CONDITIONS[0],
        side: "left",
      },
    });
    record(
      "Movement rejects non-pilot side",
      badSide.status === 400 ? "PASS" : "FAIL",
      "400",
      `${badSide.status} ${badSide.json?.error ?? ""}`,
    );

    const move1 = await http("POST", "/api/research/volunteer/movement-sessions", {
      token: sessionToken,
      body: validMovementBody(VOLUNTEER_PROTOCOL_CONDITIONS[0]),
    });
    record(
      "Movement block 1",
      move1.status === 200 && move1.json?.blockIndex === 1 ? "PASS" : "FAIL",
      "200 blockIndex=1",
      `${move1.status} blockIndex=${move1.json?.blockIndex ?? "?"}`,
    );

    const move2 = await http("POST", "/api/research/volunteer/movement-sessions", {
      token: sessionToken,
      body: validMovementBody(VOLUNTEER_PROTOCOL_CONDITIONS[1]),
    });
    record(
      "Movement block 2",
      move2.status === 200 && move2.json?.blockIndex === 2 ? "PASS" : "FAIL",
      "200 blockIndex=2",
      `${move2.status} blockIndex=${move2.json?.blockIndex ?? "?"}`,
    );

    if (collectionSessionId) {
      const { data: blocks, error: blocksErr } = await admin
        .from(MOVEMENT_TABLE)
        .select("block_index, movement_type, protocol_condition, side")
        .eq("collection_session_id", collectionSessionId)
        .order("block_index", { ascending: true });

      const blocksOk =
        !blocksErr &&
        blocks?.length === 2 &&
        blocks[0].block_index === 1 &&
        blocks[1].block_index === 2;
      record(
        "DB movement rows persisted",
        blocksOk ? "PASS" : "FAIL",
        "2 rows indices 1..2",
        blocksErr ? blocksErr.code ?? "error" : `${blocks?.length ?? 0} rows`,
      );

      const metaOk = Boolean(
        blocks?.every(
          (b) =>
            b.movement_type === MOVEMENT_TYPE &&
            b.side === VOLUNTEER_PILOT_SIDE &&
            VOLUNTEER_PROTOCOL_CONDITIONS.includes(b.protocol_condition),
        ),
      );
      record(
        "DB movement metadata values",
        metaOk ? "PASS" : "FAIL",
        `${MOVEMENT_TYPE}/${VOLUNTEER_PILOT_SIDE}`,
        blocks ? `${blocks[0].movement_type}/${blocks[0].side}` : "n/a",
      );
    }

    if (process.env.VOLUNTEER_QA_RUN_REPETITIONS === "true") {
      const move1MovementSessionId =
        typeof move1.json?.movementSessionId === "string" ? move1.json.movementSessionId : null;

      if (!move1MovementSessionId) {
        record(
          "Repetition live QA",
          "FAIL",
          "movementSessionId from movement block 1",
          "missing",
          "Cannot run repetition QA without a movement session id",
        );
      } else {
        repetitionMovementSessionId = move1MovementSessionId;

        // Minimal synthetic valid Shoulder Abduction v1 payload — not dev-data, not clinical thresholds.
        const fixture = buildVolunteerRepetitionFixture({
          movementSessionId: move1MovementSessionId,
        });
        const repetitionBody = {
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

        const repFirst = await http("POST", "/api/research/volunteer/repetitions", {
          token: sessionToken,
          body: repetitionBody,
        });
        const repFirstOk =
          repFirst.status === 200 &&
          repFirst.json?.created === true &&
          typeof repFirst.json?.repetitionId === "string";
        record(
          "Repetition first persistence",
          repFirstOk ? "PASS" : "FAIL",
          "200 created=true + repetitionId",
          `${repFirst.status} created=${repFirst.json?.created} keys=${Object.keys(repFirst.json ?? {}).join(",")}`,
        );

        const repetitionId = repFirstOk ? repFirst.json.repetitionId : null;

        const repRetry = await http("POST", "/api/research/volunteer/repetitions", {
          token: sessionToken,
          body: repetitionBody,
        });
        const repRetryOk =
          repRetry.status === 200 &&
          repRetry.json?.created === false &&
          repRetry.json?.repetitionId === repetitionId;
        record(
          "Repetition identical retry idempotent",
          repRetryOk ? "PASS" : "FAIL",
          "200 created=false same repetitionId",
          `${repRetry.status} created=${repRetry.json?.created} repetitionId=${
            repRetry.json?.repetitionId === repetitionId ? "match" : "mismatch"
          }`,
        );

        const repConflict = await http("POST", "/api/research/volunteer/repetitions", {
          token: sessionToken,
          body: { ...repetitionBody, repetitionIndex: repetitionBody.repetitionIndex + 1 },
        });
        record(
          "Repetition conflicting reuse rejected",
          repConflict.status === 409 ? "PASS" : "FAIL",
          "409",
          String(repConflict.status),
        );

        if (repetitionId) {
          const { data: repRow } = await admin
            .from(REPETITION_TABLE)
            .select("id, movement_session_id, client_submission_id, payload_hash")
            .eq("id", repetitionId)
            .maybeSingle();
          const expectedHash = hashVolunteerRepetitionPayload(fixture);
          const repRowOk =
            repRow?.movement_session_id === move1MovementSessionId &&
            repRow?.client_submission_id === fixture.clientSubmissionId &&
            repRow?.payload_hash === expectedHash;
          record(
            "DB repetition row persisted",
            repRowOk ? "PASS" : "FAIL",
            "row present with matching payload hash",
            repRow ? (repRowOk ? "match" : "mismatch") : "row-missing",
          );
        } else {
          record(
            "DB repetition row persisted",
            "SKIP",
            "row present with matching payload hash",
            "no repetitionId from first persistence",
          );
        }
      }
    } else {
      record(
        "Repetition live QA",
        "SKIP",
        "VOLUNTEER_QA_RUN_REPETITIONS=true",
        "VOLUNTEER_QA_RUN_REPETITIONS unset — Migration 022 live checks not run",
      );
    }

    const complete1 = await http("PATCH", "/api/research/volunteer/session/complete", {
      token: sessionToken,
    });
    const hasDeletionCode =
      complete1.status === 200 &&
      typeof complete1.json?.deletionCode === "string" &&
      complete1.json.deletionCode.includes("-");
    record(
      "Completion first call",
      hasDeletionCode ? "PASS" : "FAIL",
      "200 + deletionCode",
      `${complete1.status} keys=${Object.keys(complete1.json ?? {}).join(",")}`,
    );

    const complete2 = await http("PATCH", "/api/research/volunteer/session/complete", {
      token: sessionToken,
    });
    const repeatOk =
      complete2.status === 200 &&
      complete2.json?.alreadyCompleted === true &&
      complete2.json?.deletionCode === undefined;
    record(
      "Completion repeat call",
      repeatOk ? "PASS" : "FAIL",
      "200 alreadyCompleted without deletionCode",
      `${complete2.status} alreadyCompleted=${complete2.json?.alreadyCompleted}`,
    );

    const moveAfterComplete = await http("POST", "/api/research/volunteer/movement-sessions", {
      token: sessionToken,
      body: validMovementBody(VOLUNTEER_PROTOCOL_CONDITIONS[2]),
    });
    record(
      "Movement after completion rejected",
      moveAfterComplete.status === 404 ? "PASS" : "FAIL",
      "404",
      String(moveAfterComplete.status),
    );

    if (collectionSessionId && hasDeletionCode) {
      const { data: completedRow } = await admin
        .from(COLLECTION_TABLE)
        .select("status, completed_at, deletion_code_hash")
        .eq("id", collectionSessionId)
        .maybeSingle();

      record(
        "DB status completed",
        completedRow?.status === "completed" ? "PASS" : "FAIL",
        "completed",
        completedRow?.status ?? "missing",
      );
      record(
        "DB stores deletion hash not raw code",
        completedRow?.deletion_code_hash ? "PASS" : "FAIL",
        "hash present",
        completedRow?.deletion_code_hash ? "hash-present" : "missing",
      );
    }
  } finally {
    await cleanupQaRows(admin, collectionSessionId, repetitionMovementSessionId);
  }

  const passed = results.filter((r) => r.status === "PASS").length;
  const failed = results.filter((r) => r.status === "FAIL");
  const skipped = results.filter((r) => r.status === "SKIP").length;

  console.log("\n--- SUMMARY ---");
  console.log(`PASS: ${passed}  FAIL: ${failed.length}  SKIP: ${skipped}`);

  if (failed.length) {
    for (const f of failed) {
      console.log(`FAIL: ${f.name} (expected ${f.expected}, actual ${f.actual})`);
    }
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Smoke harness error:", redact(err.message));
  process.exit(1);
});
