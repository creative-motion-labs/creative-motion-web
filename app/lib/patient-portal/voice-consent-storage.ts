"use client";

import { useSyncExternalStore } from "react";

export const RASQ_VOICE_CONSENT_STORAGE_KEY = "rasq_voice_consent";

const listeners = new Set<() => void>();

function subscribe(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange);
  return () => {
    listeners.delete(onStoreChange);
  };
}

export function notifyRasqVoiceConsentStorageChanged(): void {
  for (const listener of listeners) {
    listener();
  }
}

export function readRasqVoiceConsentFromStorage(): boolean {
  if (typeof sessionStorage === "undefined") {
    return false;
  }
  try {
    return sessionStorage.getItem(RASQ_VOICE_CONSENT_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function persistRasqVoiceConsent(): void {
  if (typeof sessionStorage === "undefined") {
    return;
  }
  try {
    sessionStorage.setItem(RASQ_VOICE_CONSENT_STORAGE_KEY, "1");
    notifyRasqVoiceConsentStorageChanged();
  } catch {
    /* private mode / quota */
  }
}

function getServerSnapshot(): boolean {
  return false;
}

/** Hydration-safe read of session voice consent (explicit accept stored in sessionStorage). */
export function useRasqVoiceConsentFromStorage(): boolean {
  return useSyncExternalStore(
    subscribe,
    readRasqVoiceConsentFromStorage,
    getServerSnapshot,
  );
}
