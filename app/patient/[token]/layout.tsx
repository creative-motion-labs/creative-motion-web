"use client";

import { useParams } from "next/navigation";
import { PatientLanguageProvider, usePatientLanguage } from "@/app/components/patient/PatientLanguageProvider";
import { PatientLanguageToggle } from "@/app/components/patient/PatientLanguageToggle";
import { PatientSafetyNotice } from "@/app/components/patient/PatientSafetyNotice";
import { TrustFooter } from "@/app/components/trust/TrustFooter";
import { PatientWorkspaceNav } from "@/app/components/patient/workspace/PatientWorkspaceNav";
import { tokenLayoutUi, trustFooterUi } from "@/app/lib/patient-portal-ui";
import { patientPortalArabicClass } from "@/app/lib/rasq-typography";

const PATIENT_TOKEN_SHELL_WIDTH = "mx-auto w-full max-w-[680px] lg:max-w-[880px]";

export default function PatientTokenLayout({ children }: { children: React.ReactNode }) {
  const params = useParams();
  const token = String(params.token ?? "");

  return (
    <PatientLanguageProvider token={token}>
      <PatientTokenLayoutShell>{children}</PatientTokenLayoutShell>
    </PatientLanguageProvider>
  );
}

function PatientTokenLayoutShell({ children }: { children: React.ReactNode }) {
  const { language, assignedBy, textDir, isArabic } = usePatientLanguage();
  const layoutUi = tokenLayoutUi(language);
  const portalFontClass = patientPortalArabicClass(isArabic);

  return (
    <div
      className={`min-h-screen bg-[#EEF2F0] ${portalFontClass}`}
      dir={textDir}
      lang={language}
    >
      <nav className="sticky top-0 z-10 flex h-[52px] items-center justify-between border-b border-[#E2E8E5] bg-white px-5">
        <span className="rasq-wordmark text-[14px] text-[#0A0F1A]">RASQ</span>
        <div className="flex items-center gap-3">
          <PatientLanguageToggle />
          {assignedBy && (
            <span className="text-[12px] text-[#6B7280]" dir="ltr">
              {layoutUi.assignedBy(assignedBy)}
            </span>
          )}
        </div>
      </nav>

      <main className={`${PATIENT_TOKEN_SHELL_WIDTH} px-6 py-8 pb-28 md:px-8`}>
        {children}
        <PatientSafetyNotice />
      </main>

      <PatientWorkspaceNav />

      <TrustFooter
        variant="light"
        labels={trustFooterUi(language)}
        className={`${PATIENT_TOKEN_SHELL_WIDTH} px-6 pb-28 md:px-8`}
      />
    </div>
  );
}
