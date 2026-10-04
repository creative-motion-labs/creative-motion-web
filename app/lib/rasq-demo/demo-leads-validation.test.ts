/**
 * Run: npx tsx --test app/lib/rasq-demo/demo-leads-validation.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  mapRasqDemoLeadPersistenceError,
  validateRasqDemoLeadBody,
  validateRasqDemoLeadShareFormFields,
} from "./demo-leads-validation";

describe("validateRasqDemoLeadBody", () => {
  it("accepts empty optional contact and skips persistence flag", () => {
    const result = validateRasqDemoLeadBody({
      demoSessionId: "abc-123",
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.hasContactOrConsent, false);
      assert.equal(result.value.consentRasqUpdates, false);
      assert.equal(result.value.consentPilotStudy, false);
    }
  });

  it("rejects invalid email and unknown fields", () => {
    const badEmail = validateRasqDemoLeadBody({
      demoSessionId: "abc",
      email: "not-an-email",
    });
    assert.equal(badEmail.ok, false);

    const extra = validateRasqDemoLeadBody({
      demoSessionId: "abc",
      patientId: "steal",
    });
    assert.equal(extra.ok, false);
  });

  it("marks contact when any optional field is provided", () => {
    const result = validateRasqDemoLeadBody({
      demoSessionId: "abc",
      mainGoal: "mobility",
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.hasContactOrConsent, true);
      assert.equal(result.value.mainGoal, "mobility");
      assert.equal(result.submitIntent, "share");
    }
  });

  it("rejects Share details form with empty fields on the client", () => {
    const empty = validateRasqDemoLeadShareFormFields({
      name: "",
      email: "",
      phone: "",
      mainGoal: "",
      consentRasqUpdates: false,
      consentPilotStudy: false,
    });
    assert.equal(empty.ok, false);

    const badEmail = validateRasqDemoLeadShareFormFields({
      name: "",
      email: "not-valid",
      phone: "",
      mainGoal: "",
      consentRasqUpdates: false,
      consentPilotStudy: false,
    });
    assert.equal(badEmail.ok, false);
  });

  it("maps missing rasq_demo_leads table errors to migration guidance", () => {
    const mapped = mapRasqDemoLeadPersistenceError(
      'relation "public.rasq_demo_leads" does not exist',
    );
    assert.match(mapped, /migration 026/i);
  });

  it("accepts explicit skip submitIntent without requiring contact", () => {
    const result = validateRasqDemoLeadBody({
      demoSessionId: "abc",
      submitIntent: "skip",
      email: "skip@example.com",
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.submitIntent, "skip");
    }
  });
});
