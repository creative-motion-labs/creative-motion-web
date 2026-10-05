/**
 * Run: npx tsx --test app/lib/patient-portal/patient-route-fetch-guard.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { shouldIgnorePatientRouteFetchResult } from "./patient-route-fetch-guard";

describe("patient route fetch guard", () => {
  it("ignores aborted requests", () => {
    assert.equal(
      shouldIgnorePatientRouteFetchResult({
        aborted: true,
        activeToken: "a",
        responseToken: "a",
      }),
      true,
    );
  });

  it("ignores stale token responses after client navigation", () => {
    assert.equal(
      shouldIgnorePatientRouteFetchResult({
        aborted: false,
        activeToken: "token-b",
        responseToken: "token-a",
      }),
      true,
    );
  });

  it("accepts matching active and response tokens", () => {
    assert.equal(
      shouldIgnorePatientRouteFetchResult({
        aborted: false,
        activeToken: "token-a",
        responseToken: "token-a",
      }),
      false,
    );
  });
});
