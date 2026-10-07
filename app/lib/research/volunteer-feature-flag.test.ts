/**
 * Run: npx tsx --test app/lib/research/volunteer-feature-flag.test.ts
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { isVolunteerCollectionEnabled } from "./volunteer-feature-flag";

describe("volunteer-feature-flag", { concurrency: 1 }, () => {
  let saved: string | undefined;

  before(() => {
    saved = process.env.ML_VOLUNTEER_COLLECTION_ENABLED;
  });

  after(() => {
    if (saved === undefined) delete process.env.ML_VOLUNTEER_COLLECTION_ENABLED;
    else process.env.ML_VOLUNTEER_COLLECTION_ENABLED = saved;
  });

  it("defaults OFF when unset", () => {
    delete process.env.ML_VOLUNTEER_COLLECTION_ENABLED;
    assert.equal(isVolunteerCollectionEnabled(), false);
  });

  it("is ON only when explicitly true", () => {
    process.env.ML_VOLUNTEER_COLLECTION_ENABLED = "true";
    assert.equal(isVolunteerCollectionEnabled(), true);
    process.env.ML_VOLUNTEER_COLLECTION_ENABLED = "1";
    assert.equal(isVolunteerCollectionEnabled(), false);
  });
});
