import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  generateRemoteUlmsToken,
  hashRemoteUlmsToken,
  remoteUlmsPatientAssessmentPath,
} from "./remote-assessment-token";

describe("remote-assessment-token", () => {
  it("hashes tokens deterministically", () => {
    const token = "abc-123";
    assert.equal(hashRemoteUlmsToken(token), hashRemoteUlmsToken(" abc-123 "));
  });

  it("builds patient assessment path", () => {
    assert.equal(remoteUlmsPatientAssessmentPath("tok"), "/patient/assessment/tok");
  });

  it("generates uuid tokens", () => {
    const token = generateRemoteUlmsToken();
    assert.match(token, /^[0-9a-f-]{36}$/i);
  });
});
