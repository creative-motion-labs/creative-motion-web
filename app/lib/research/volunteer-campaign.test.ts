/**
 * Run: npx tsx --test app/lib/research/volunteer-campaign.test.ts
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import {
  hashVolunteerCampaignCodeForEnvSetup,
  isVolunteerCampaignCodeConfigured,
  verifyVolunteerCampaignCode,
} from "./volunteer-campaign";

describe("volunteer-campaign", { concurrency: 1 }, () => {
  let savedHash: string | undefined;

  before(() => {
    savedHash = process.env.VOLUNTEER_CAMPAIGN_CODE_HASH;
    process.env.VOLUNTEER_CAMPAIGN_CODE_HASH = hashVolunteerCampaignCodeForEnvSetup(
      "pilot-shared-code",
    );
  });

  after(() => {
    if (savedHash === undefined) delete process.env.VOLUNTEER_CAMPAIGN_CODE_HASH;
    else process.env.VOLUNTEER_CAMPAIGN_CODE_HASH = savedHash;
  });

  it("reports configured when hash env is present", () => {
    assert.equal(isVolunteerCampaignCodeConfigured(), true);
  });

  it("accepts matching campaign codes with trim normalization", () => {
    assert.equal(verifyVolunteerCampaignCode("  pilot-shared-code  "), true);
  });

  it("rejects invalid campaign codes", () => {
    assert.equal(verifyVolunteerCampaignCode("wrong-code"), false);
    assert.equal(verifyVolunteerCampaignCode(""), false);
    assert.equal(verifyVolunteerCampaignCode(null), false);
  });
});
