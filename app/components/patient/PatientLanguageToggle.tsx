"use client";

import { usePatientLanguage } from "@/app/components/patient/PatientLanguageProvider";
import { PATIENT_PRIMARY_TOUCH_MIN_CLASS } from "@/app/lib/patient-portal-touch-targets";

export function PatientLanguageToggle() {
  const { language, setLanguage } = usePatientLanguage();

  return (
    <div
      className={`inline-flex rounded-[6px] border border-[#E2E8E5] bg-[#F4F6F5] p-0.5 ${PATIENT_PRIMARY_TOUCH_MIN_CLASS}`}
      role="group"
      aria-label="Portal language"
      dir="ltr"
    >
      <button
        type="button"
        aria-pressed={language === "ar"}
        onClick={() => setLanguage("ar")}
        className={`rounded-[5px] px-3 text-[11px] font-semibold transition ${PATIENT_PRIMARY_TOUCH_MIN_CLASS} ${
          language === "ar"
            ? "bg-white text-[#0A0F1A] shadow-sm"
            : "text-[#6B7280] hover:text-[#374151]"
        }`}
      >
        العربية
      </button>
      <button
        type="button"
        aria-pressed={language === "en"}
        onClick={() => setLanguage("en")}
        className={`rounded-[5px] px-3 text-[11px] font-semibold transition ${PATIENT_PRIMARY_TOUCH_MIN_CLASS} ${
          language === "en"
            ? "bg-white text-[#0A0F1A] shadow-sm"
            : "text-[#6B7280] hover:text-[#374151]"
        }`}
      >
        English
      </button>
    </div>
  );
}
