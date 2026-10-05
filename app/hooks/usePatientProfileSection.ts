"use client";

import { useCallback, useEffect, useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  type PatientProfileWorkspaceSection,
  resolvePatientProfileSection,
  resolvePatientProfileSectionFromHash,
} from "@/app/lib/clinician/patient-profile-workspace-sections";

function buildPatientProfileSectionHref(
  pathname: string,
  searchParams: URLSearchParams,
  section: PatientProfileWorkspaceSection,
): string {
  const params = new URLSearchParams(searchParams.toString());
  if (section === "overview") {
    params.delete("section");
  } else {
    params.set("section", section);
  }
  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}

export function usePatientProfileSection() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();

  const sectionParam = searchParams.get("section");

  const section = useMemo(
    () => resolvePatientProfileSection(sectionParam, ""),
    [sectionParam],
  );

  const setSection = useCallback(
    (next: PatientProfileWorkspaceSection) => {
      const href = buildPatientProfileSectionHref(
        pathname,
        new URLSearchParams(searchParams.toString()),
        next,
      );
      router.push(href, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  useEffect(() => {
    if (sectionParam) return;
    const hashSection = resolvePatientProfileSectionFromHash(
      window.location.hash,
    );
    if (!hashSection) return;
    const href = buildPatientProfileSectionHref(
      pathname,
      new URLSearchParams(searchParams.toString()),
      hashSection,
    );
    router.replace(href, { scroll: false });
  }, [pathname, router, searchParams, sectionParam]);

  useEffect(() => {
    const onHashChange = () => {
      const hashSection = resolvePatientProfileSectionFromHash(
        window.location.hash,
      );
      if (!hashSection) return;
      const href = buildPatientProfileSectionHref(
        pathname,
        new URLSearchParams(searchParams.toString()),
        hashSection,
      );
      router.replace(href, { scroll: false });
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, [pathname, router, searchParams]);

  return { section, setSection };
}
