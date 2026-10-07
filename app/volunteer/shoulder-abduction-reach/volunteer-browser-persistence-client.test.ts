/**
 * Run: npx tsx --test app/volunteer/shoulder-abduction-reach/volunteer-browser-persistence-client.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  VOLUNTEER_CONSENT_VERSION,
  VOLUNTEER_PROTOCOL_VERSION,
  VOLUNTEER_SESSION_TOKEN_HEADER,
} from "@/app/lib/research/volunteer-constants";
import { buildVolunteerRepetitionFixture } from "@/app/lib/research/volunteer-repetition-validation";
import {
  VOLUNTEER_PERSISTENCE_API_ROUTES,
  createVolunteerBrowserPersistenceClient,
} from "./volunteer-browser-persistence-client";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("volunteer-browser-persistence-client", () => {
  it("creates session with campaign code only in body and no token header", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const client = createVolunteerBrowserPersistenceClient(async (url, init) => {
      calls.push({ url: String(url), init });
      return jsonResponse({
        sessionToken: "tok-session-abc123456789",
        expiresAt: "2026-08-25T12:00:00.000Z",
      });
    });

    const result = await client.createSession("  PILOT-CODE  ");
    assert.equal(result.ok, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0]!.url, VOLUNTEER_PERSISTENCE_API_ROUTES.sessions);
    const body = JSON.parse(String(calls[0]!.init?.body));
    assert.equal(body.campaignCode, "PILOT-CODE");
    assert.equal(body.ageConfirmed18Plus, true);
    assert.equal(body.consentVersion, VOLUNTEER_CONSENT_VERSION);
    assert.equal(body.protocolVersion, VOLUNTEER_PROTOCOL_VERSION);
    assert.equal(body.consentAcceptedAtMs, undefined);
    assert.equal(body.participantId, undefined);
    const headers = calls[0]!.init?.headers as Record<string, string>;
    assert.equal(headers[VOLUNTEER_SESSION_TOKEN_HEADER], undefined);
    assert.equal(calls[0]!.init?.credentials, "omit");
    assert.equal(calls[0]!.init?.cache, "no-store");
  });

  it("sends movement session with token header only", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const client = createVolunteerBrowserPersistenceClient(async (url, init) => {
      calls.push({ url: String(url), init });
      return jsonResponse({ movementSessionId: crypto.randomUUID(), blockIndex: 1 });
    });

    const result = await client.createMovementSession("tok-movement-header-test", {
      movementType: "shoulder_abduction_reach",
      protocolCondition: "NORMAL",
      side: "right",
    });
    assert.equal(result.ok, true);
    const body = JSON.parse(String(calls[0]!.init?.body));
    assert.equal(body.movementType, "shoulder_abduction_reach");
    assert.equal(body.sessionToken, undefined);
    const headers = calls[0]!.init?.headers as Record<string, string>;
    assert.equal(headers[VOLUNTEER_SESSION_TOKEN_HEADER], "tok-movement-header-test");
  });

  it("submits repetition without token in body", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fixture = buildVolunteerRepetitionFixture();
    const client = createVolunteerBrowserPersistenceClient(async (url, init) => {
      calls.push({ url: String(url), init });
      return jsonResponse({ repetitionId: crypto.randomUUID(), created: true });
    });

    const result = await client.submitRepetition("tok-rep-test", fixture);
    assert.equal(result.ok, true);
    const body = JSON.parse(String(calls[0]!.init?.body));
    assert.equal(body.movementSessionId, fixture.movementSessionId);
    assert.equal(body.clientSubmissionId, fixture.clientSubmissionId);
    assert.equal(body.participantId, undefined);
    assert.equal(body.devSessionId, undefined);
    assert.equal(body.sessionToken, undefined);
    const headers = calls[0]!.init?.headers as Record<string, string>;
    assert.equal(headers[VOLUNTEER_SESSION_TOKEN_HEADER], "tok-rep-test");
  });

  it("completes session with PATCH and token header only", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const client = createVolunteerBrowserPersistenceClient(async (url, init) => {
      calls.push({ url: String(url), init });
      return jsonResponse({ ok: true, deletionCode: "ABCD-EFGH-IJKL-MNOP" });
    });

    const result = await client.completeSession("tok-complete-test");
    assert.equal(result.ok, true);
    assert.equal(calls[0]!.init?.method, "PATCH");
    assert.equal(calls[0]!.init?.body, undefined);
    const headers = calls[0]!.init?.headers as Record<string, string>;
    assert.equal(headers[VOLUNTEER_SESSION_TOKEN_HEADER], "tok-complete-test");
  });

  it("maps invalid campaign 404 to invalid_campaign", async () => {
    const client = createVolunteerBrowserPersistenceClient(async () =>
      jsonResponse({ error: "not found" }, 404),
    );
    const result = await client.createSession("bad-code");
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error.kind, "invalid_campaign");
      assert.equal(result.error.retryable, false);
    }
  });

  it("maps 503 to feature_disabled", async () => {
    const client = createVolunteerBrowserPersistenceClient(async () => jsonResponse({}, 503));
    const result = await client.createSession("code");
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.kind, "feature_disabled");
  });

  it("maps 409 to conflict", async () => {
    const client = createVolunteerBrowserPersistenceClient(async () => jsonResponse({}, 409));
    const result = await client.submitRepetition("tok", buildVolunteerRepetitionFixture());
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.kind, "conflict");
  });

  it("maps 413 to payload_too_large", async () => {
    const client = createVolunteerBrowserPersistenceClient(async () => jsonResponse({}, 413));
    const result = await client.submitRepetition("tok", buildVolunteerRepetitionFixture());
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.kind, "payload_too_large");
  });

  it("maps 429 and 5xx to retryable", async () => {
    for (const status of [429, 500, 502]) {
      const client = createVolunteerBrowserPersistenceClient(async () => jsonResponse({}, status));
      const result = await client.submitRepetition("tok", buildVolunteerRepetitionFixture());
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.error.retryable, true);
    }
  });

  it("rejects malformed success responses", async () => {
    const client = createVolunteerBrowserPersistenceClient(async () =>
      jsonResponse({ sessionToken: "only-token" }),
    );
    const result = await client.createSession("code");
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.kind, "malformed_response");
  });

  it("accepts completion alreadyCompleted response", async () => {
    const client = createVolunteerBrowserPersistenceClient(async () =>
      jsonResponse({ ok: true, alreadyCompleted: true }),
    );
    const result = await client.completeSession("tok");
    assert.equal(result.ok, true);
    if (result.ok) assert.equal("alreadyCompleted" in result.value, true);
  });

  it("treats network throw as retryable", async () => {
    const client = createVolunteerBrowserPersistenceClient(async () => {
      throw new Error("network down");
    });
    const result = await client.createSession("code");
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error.kind, "retryable");
      assert.equal(result.error.retryable, true);
    }
  });
});
