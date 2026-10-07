/**
 * Run: npx tsx --test app/lib/research/volunteer-research-proxy.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import path from "node:path";

const proxy = readFileSync(
  path.resolve(import.meta.dirname, "../../../proxy.ts"),
  "utf8",
);

describe("proxy public paths — volunteer research", () => {
  it("lists exact volunteer API paths only", () => {
    assert.match(proxy, /"\/api\/research\/volunteer\/sessions"/);
    assert.match(proxy, /"\/api\/research\/volunteer\/movement-sessions"/);
    assert.match(proxy, /"\/api\/research\/volunteer\/session\/complete"/);
    assert.match(proxy, /"\/api\/research\/volunteer\/repetitions"/);
    assert.doesNotMatch(proxy, /"\/api\/research\/volunteer\/"/);
  });

  it("does not add a broad /api/research/volunteer/ prefix", () => {
    const prefixBlock = proxy.slice(
      proxy.indexOf("PUBLIC_PREFIXES"),
      proxy.indexOf("PUBLIC_PATHS"),
    );
    assert.doesNotMatch(prefixBlock, /\/api\/research\/volunteer/);
  });

  it("keeps clinician routes structurally protected", () => {
    const prefixBlock = proxy.slice(
      proxy.indexOf("PUBLIC_PREFIXES"),
      proxy.indexOf("PUBLIC_PATHS"),
    );
    const pathsBlock = proxy.slice(
      proxy.indexOf("PUBLIC_PATHS"),
      proxy.indexOf("function isPublic"),
    );
    assert.doesNotMatch(prefixBlock, /"\/clinician"/);
    assert.doesNotMatch(pathsBlock, /"\/clinician"/);
    assert.doesNotMatch(prefixBlock, /"\/api\/clinician\/"/);
    assert.doesNotMatch(pathsBlock, /"\/api\/clinician\/"/);
  });

  it("preserves patient public prefix behavior", () => {
    assert.match(proxy, /"\/api\/patient\/"/);
    assert.match(proxy, /"\/patient\/"/);
  });
});
