/**
 * Run: npx tsx --test app/lib/patient-portal/voice-consent-storage.test.ts
 */
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  RASQ_VOICE_CONSENT_STORAGE_KEY,
  persistRasqVoiceConsent,
  readRasqVoiceConsentFromStorage,
} from "./voice-consent-storage";

describe("RASQ voice consent storage", () => {
  afterEach(() => {
    // @ts-expect-error cleanup
    delete globalThis.sessionStorage;
  });

  it("reads false when sessionStorage is unavailable", () => {
    assert.equal(readRasqVoiceConsentFromStorage(), false);
  });

  it("reads false before explicit persist", () => {
    const store = new Map<string, string>();
    // @ts-expect-error test shim
    globalThis.sessionStorage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
    };
    assert.equal(readRasqVoiceConsentFromStorage(), false);
  });

  it("persists explicit consent for the session", () => {
    const store = new Map<string, string>();
    // @ts-expect-error test shim
    globalThis.sessionStorage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
    };

    persistRasqVoiceConsent();
    assert.equal(store.get(RASQ_VOICE_CONSENT_STORAGE_KEY), "1");
    assert.equal(readRasqVoiceConsentFromStorage(), true);
  });

  it("returns false when sessionStorage throws (private mode)", () => {
    // @ts-expect-error test shim
    globalThis.sessionStorage = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
    };
    assert.equal(readRasqVoiceConsentFromStorage(), false);
    persistRasqVoiceConsent();
    assert.equal(readRasqVoiceConsentFromStorage(), false);
  });
});
