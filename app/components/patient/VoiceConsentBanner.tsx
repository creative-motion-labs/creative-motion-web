"use client";

import { voiceLabel } from "@/app/components/patient/voice-ui-labels";
import type { PatientLang } from "@/app/components/patient/LanguageToggle";
import { persistRasqVoiceConsent } from "@/app/lib/patient-portal/voice-consent-storage";

type Props = {
  lang: PatientLang;
  onAccept: () => void;
};

export function VoiceConsentBanner({ lang, onAccept }: Props) {
  function handleAccept() {
    persistRasqVoiceConsent();
    onAccept();
  }

  return (
    <div
      className="mx-auto w-full max-w-[400px] rounded-[10px] border border-[#E2E8E5] bg-white p-4"
      style={{ borderWidth: "0.5px" }}
    >
      <h3 className="text-sm font-semibold text-[#0A0F1A]">Voice input</h3>
      <p className="mt-2 text-xs leading-relaxed text-[#0A0F1A]">
        {voiceLabel("privacyNote", lang)}
      </p>
      <p className="mt-2 text-xs leading-relaxed text-[#374151]">
        {voiceLabel("reviewBeforeSubmit", lang)} Clinician review required.
      </p>
      <button
        type="button"
        onClick={handleAccept}
        className="mt-4 w-full rounded-[7px] bg-[#1D9E75] py-2.5 text-sm font-semibold text-white transition hover:bg-[#179165]"
      >
        I understand — enable voice
      </button>
    </div>
  );
}
