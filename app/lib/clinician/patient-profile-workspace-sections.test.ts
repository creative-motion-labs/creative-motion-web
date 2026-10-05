import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  PATIENT_PROFILE_SECTION_NAV,
  resolvePatientProfileSection,
  resolvePatientProfileSectionFromHash,
} from "./patient-profile-workspace-sections";

describe("patient-profile-workspace-sections", () => {
  it("defaults to overview", () => {
    assert.equal(resolvePatientProfileSection(null, ""), "overview");
  });

  it("honours section query param", () => {
    assert.equal(resolvePatientProfileSection("plan", ""), "plan");
  });

  it("maps legacy hashes when section param missing", () => {
    assert.equal(
      resolvePatientProfileSectionFromHash("#movement-tracking-sessions"),
      "movement",
    );
    assert.equal(
      resolvePatientProfileSection(null, "#rehabilitation-plan"),
      "plan",
    );
  });

  it("prefers section param over hash", () => {
    assert.equal(
      resolvePatientProfileSection("overview", "#rehabilitation-plan"),
      "overview",
    );
  });

  it("defines one canonical tabpanel id per workspace section", () => {
    const panelIds = PATIENT_PROFILE_SECTION_NAV.map(
      (item) => `patient-profile-section-${item.id}`,
    );
    assert.equal(new Set(panelIds).size, panelIds.length);
    assert.equal(panelIds.length, 6);
  });
});
