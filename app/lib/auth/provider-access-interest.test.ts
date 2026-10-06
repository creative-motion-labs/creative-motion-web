/**
 * Run: npx tsx --test app/lib/auth/provider-access-interest.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  mapProviderAccessInterestPersistenceError,
  validateProviderAccessInterestBody,
  validateProviderAccessInterestFormFields,
} from "./provider-access-interest-validation";

describe("validateProviderAccessInterestBody", () => {
  it("requires a valid email and rejects unknown fields", () => {
    const missing = validateProviderAccessInterestBody({});
    assert.equal(missing.ok, false);

    const badEmail = validateProviderAccessInterestBody({ email: "not-an-email" });
    assert.equal(badEmail.ok, false);

    const extra = validateProviderAccessInterestBody({
      email: "a@b.co",
      password: "secret",
    });
    assert.equal(extra.ok, false);
  });

  it("accepts email with optional name and clinic", () => {
    const result = validateProviderAccessInterestBody({
      email: "Provider@Clinic.COM",
      fullName: " Dr. Test ",
      clinicName: " Main Clinic ",
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.value.email, "provider@clinic.com");
      assert.equal(result.value.fullName, "Dr. Test");
      assert.equal(result.value.clinicName, "Main Clinic");
    }
  });
});

describe("validateProviderAccessInterestFormFields", () => {
  it("requires email on the client", () => {
    assert.equal(validateProviderAccessInterestFormFields({ email: "" }).ok, false);
    assert.equal(validateProviderAccessInterestFormFields({ email: "a@b.co" }).ok, true);
  });
});

describe("mapProviderAccessInterestPersistenceError", () => {
  it("maps missing table errors to a generic safe message", () => {
    const mapped = mapProviderAccessInterestPersistenceError(
      'relation "public.provider_access_interest" does not exist',
    );
    assert.match(mapped, /Unable to submit/);
  });
});
