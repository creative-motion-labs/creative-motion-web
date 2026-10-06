/**
 * Run: npx tsx --test app/lib/rasq-demo/demo-visitor-session-identity.test.ts
 */
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  getOrCreateRasqDemoVisitorSessionId,
  RASQ_DEMO_VISITOR_SESSION_STORAGE_KEY,
} from "./demo-analytics-client";

describe("RASQ demo visitor session identity", () => {
  afterEach(() => {
    // @ts-expect-error cleanup
    delete globalThis.sessionStorage;
  });

  it("returns the same visitor id on repeated reads in normal mode", () => {
    const store = new Map<string, string>();
    // @ts-expect-error test shim
    globalThis.sessionStorage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
    };

    const first = getOrCreateRasqDemoVisitorSessionId({ internalTest: false });
    const second = getOrCreateRasqDemoVisitorSessionId({ internalTest: false });
    assert.equal(first, second);
    assert.equal(store.get(RASQ_DEMO_VISITOR_SESSION_STORAGE_KEY), first);
  });
});
