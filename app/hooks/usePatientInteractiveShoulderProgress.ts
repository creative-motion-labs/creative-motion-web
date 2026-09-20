"use client";

import { useCallback, useEffect, useState } from "react";
import type { PatientInteractiveShoulderProgressResponse } from "@/app/api/patient/interactive-shoulder-progress/route";
import { PATIENT_PORTAL_REFRESH_EVENT } from "@/app/lib/patient-portal-refresh";

export function usePatientInteractiveShoulderProgress(token: string) {
  const [progress, setProgress] = useState<PatientInteractiveShoulderProgressResponse | null>(null);
  const [isLoading, setIsLoading] = useState(Boolean(token));

  const fetchProgress = useCallback(async () => {
    if (!token) {
      setProgress(null);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    try {
      const res = await fetch(
        `/api/patient/interactive-shoulder-progress?token=${encodeURIComponent(token)}`,
      );
      if (res.ok) {
        setProgress((await res.json()) as PatientInteractiveShoulderProgressResponse);
      } else {
        setProgress(null);
      }
    } catch {
      setProgress(null);
    } finally {
      setIsLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void fetchProgress();
  }, [fetchProgress]);

  useEffect(() => {
    const onRefresh = () => {
      void fetchProgress();
    };
    window.addEventListener(PATIENT_PORTAL_REFRESH_EVENT, onRefresh);
    return () => window.removeEventListener(PATIENT_PORTAL_REFRESH_EVENT, onRefresh);
  }, [fetchProgress]);

  return { progress, isLoading };
}
