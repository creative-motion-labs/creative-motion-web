import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseSafeProviderBody } from "./ensure-provider";

describe("parseSafeProviderBody", () => {
  it("ignores client-submitted role and approval fields", () => {
    const parsed = parseSafeProviderBody({
      name: "Dr. Example",
      role: "admin",
      approval_status: "approved",
    });
    assert.equal(parsed.name, "Dr. Example");
    assert.equal((parsed as { role?: string }).role, undefined);
  });
});
