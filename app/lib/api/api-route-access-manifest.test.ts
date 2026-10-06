import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import {
  APPROVED_PROVIDER_API_ROUTE_FILES,
  APPROVED_PROVIDER_GUARD_MARKERS,
  APPROVED_PROVIDER_SHARED_AUTH_FILES,
} from "./api-route-access-manifest";

const ROOT = process.cwd();

function readRouteSource(relativeFile: string): string {
  return fs.readFileSync(path.join(ROOT, relativeFile), "utf8");
}

function hasApprovedProviderGuard(source: string): boolean {
  return APPROVED_PROVIDER_GUARD_MARKERS.some((marker) => source.includes(marker));
}

describe("approved-provider API route coverage", () => {
  for (const file of APPROVED_PROVIDER_API_ROUTE_FILES) {
    it(`${file} enforces approved-provider authorization`, () => {
      const source = readRouteSource(file);
      assert.equal(
        hasApprovedProviderGuard(source),
        true,
        `missing guard marker in ${file}`,
      );
    });
  }

  for (const file of APPROVED_PROVIDER_SHARED_AUTH_FILES) {
    it(`${file} enforces approved-provider authorization`, () => {
      const source = readRouteSource(file);
      assert.equal(hasApprovedProviderGuard(source), true);
    });
  }
});
