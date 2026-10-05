"use client";

import type { ReactNode } from "react";
import type { PatientProfileWorkspaceSection } from "@/app/lib/clinician/patient-profile-workspace-sections";

type PatientProfileSectionSlotProps = {
  sectionId: PatientProfileWorkspaceSection;
  activeSection: PatientProfileWorkspaceSection;
  children: ReactNode;
  className?: string;
};

/**
 * Keeps section content mounted (preserves form state) while hiding inactive panels.
 */
export function PatientProfileSectionSlot({
  sectionId,
  activeSection,
  children,
  className = "space-y-6",
  tabPanel = true,
}: PatientProfileSectionSlotProps) {
  const isActive = activeSection === sectionId;

  return (
    <div
      {...(tabPanel
        ? {
            id: `patient-profile-section-${sectionId}`,
            role: "tabpanel" as const,
            "aria-labelledby": `patient-profile-tab-${sectionId}`,
          }
        : {})}
      hidden={!isActive}
      className={isActive ? className : undefined}
    >
      {children}
    </div>
  );
}
