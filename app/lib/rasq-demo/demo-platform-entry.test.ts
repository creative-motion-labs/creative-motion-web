/**
 * Run: npx tsx --test app/lib/rasq-demo/demo-platform-entry.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  RASQ_DEMO_PLATFORM_ENTRY_CTA_LABEL,
  RASQ_DEMO_PLATFORM_ENTRY_HREF,
  RASQ_DEMO_PLATFORM_ENTRY_SUPPORT_COPY,
} from "./demo-copy";

const ROOT = process.cwd();
const HOME = join(ROOT, "app/page.tsx");
const LOGIN = join(ROOT, "app/login/page.tsx");
const PROXY = join(ROOT, "proxy.ts");
const CTA = join(ROOT, "app/components/rasq-demo/RasqDemoPlatformEntryCta.tsx");

describe("RASQ platform demo entry", () => {
  it("defines public entry copy and /demo href", () => {
    assert.equal(RASQ_DEMO_PLATFORM_ENTRY_HREF, "/demo");
    assert.equal(RASQ_DEMO_PLATFORM_ENTRY_CTA_LABEL, "Try Interactive Demo");
    assert.match(RASQ_DEMO_PLATFORM_ENTRY_SUPPORT_COPY, /demonstration purposes only/i);
    assert.match(RASQ_DEMO_PLATFORM_ENTRY_SUPPORT_COPY, /not a medical diagnosis/i);
  });

  it("links landing and login entry points to /demo without auth coupling", () => {
    const home = readFileSync(HOME, "utf8");
    const login = readFileSync(LOGIN, "utf8");
    const cta = readFileSync(CTA, "utf8");

    assert.match(home, /RasqDemoPlatformEntryCta/);
    assert.match(login, /RasqDemoPlatformEntryCta/);
    assert.match(cta, /href=\{RASQ_DEMO_PLATFORM_ENTRY_HREF\}/);
    assert.doesNotMatch(cta, /target="_blank"/);
  });

  it("keeps /demo on the public allowlist in proxy", () => {
    const proxy = readFileSync(PROXY, "utf8");
    assert.match(proxy, /"\/demo"/);
  });
});
