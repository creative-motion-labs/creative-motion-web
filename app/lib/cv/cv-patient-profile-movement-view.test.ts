import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveCvMovementTrackingViewState } from "./cv-patient-profile-movement-view";

describe("resolveCvMovementTrackingViewState", () => {
  it("returns loading while fetch is in flight", () => {
    assert.equal(
      resolveCvMovementTrackingViewState({ loading: true, error: false, metricsCount: 3 }),
      "loading",
    );
  });

  it("returns error even when metrics array is empty", () => {
    assert.equal(
      resolveCvMovementTrackingViewState({ loading: false, error: true, metricsCount: 0 }),
      "error",
    );
  });

  it("returns empty on successful zero-record response", () => {
    assert.equal(
      resolveCvMovementTrackingViewState({ loading: false, error: false, metricsCount: 0 }),
      "empty",
    );
  });

  it("returns populated when metrics exist", () => {
    assert.equal(
      resolveCvMovementTrackingViewState({ loading: false, error: false, metricsCount: 2 }),
      "populated",
    );
  });
});
