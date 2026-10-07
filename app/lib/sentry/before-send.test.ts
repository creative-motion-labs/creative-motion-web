/**
 * Run: npx tsx --test app/lib/sentry/before-send.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ErrorEvent } from "@sentry/nextjs";
import { applySentryPrivacy } from "./before-send";

function makeEvent(url: string, init?: { data?: unknown; headers?: Record<string, string> }): ErrorEvent {
  return {
    request: {
      url,
      data: init?.data,
      headers: { ...(init?.headers ?? {}) },
    },
  } as ErrorEvent;
}

describe("applySentryPrivacy — volunteer research", () => {
  it("redacts volunteer research request bodies", () => {
    const event = makeEvent("http://localhost/api/research/volunteer/sessions", {
      data: { campaignCode: "secret" },
      headers: { "x-volunteer-session-token": "raw-token" },
    });
    const out = applySentryPrivacy(event)!;
    assert.equal(out.request?.data, "[Volunteer research request body redacted]");
    assert.equal(out.request?.headers?.["x-volunteer-session-token"], undefined);
  });

  it("redacts repetitions route bodies", () => {
    const event = makeEvent("http://localhost/api/research/volunteer/repetitions", {
      data: { frames: [{ frameIndex: 0 }] },
      headers: { "x-volunteer-session-token": "raw-token" },
    });
    const out = applySentryPrivacy(event)!;
    assert.equal(out.request?.data, "[Volunteer research request body redacted]");
    assert.equal(out.request?.headers?.["x-volunteer-session-token"], undefined);
  });

  it("redacts movement-session and complete routes", () => {
    for (const path of [
      "/api/research/volunteer/movement-sessions",
      "/api/research/volunteer/session/complete",
    ]) {
      const event = makeEvent(`http://localhost${path}`, {
        data: { movementType: "shoulder_abduction_reach" },
      });
      const out = applySentryPrivacy(event)!;
      assert.equal(out.request?.data, "[Volunteer research request body redacted]");
    }
  });

  it("strips volunteer secret-bearing headers", () => {
    const event = makeEvent("http://localhost/api/research/volunteer/sessions", {
      headers: {
        "x-volunteer-campaign-code": "secret",
        "x-volunteer-deletion-code": "ABCD-EFGH-IJKL-MNOP",
      },
    });
    const out = applySentryPrivacy(event)!;
    assert.equal(out.request?.headers?.["x-volunteer-campaign-code"], undefined);
    assert.equal(out.request?.headers?.["x-volunteer-deletion-code"], undefined);
  });
});
