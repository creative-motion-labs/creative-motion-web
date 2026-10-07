"use client";

import { useCallback, useEffect, useState } from "react";
import type { ObjectiveResultsViewModel } from "@/app/lib/progress/objective-assessment-series";

export function usePatientObjectiveResults(patientId: string | undefined) {
  const [model, setModel] = useState<ObjectiveResultsViewModel | null>(null);
  const [loading, setLoading] = useState(Boolean(patientId?.trim()));
  const [error, setError] = useState(false);

  const refresh = useCallback(async () => {
    const trimmed = patientId?.trim();
    if (!trimmed) {
      setModel(null);
      setLoading(false);
      setError(false);
      return;
    }

    setLoading(true);
    setError(false);
    try {
      const res = await fetch(
        `/api/clinician/objective-results?patientId=${encodeURIComponent(trimmed)}`,
        { cache: "no-store" },
      );
      if (!res.ok) {
        setError(true);
        setModel(null);
        return;
      }
      setModel((await res.json()) as ObjectiveResultsViewModel);
    } catch {
      setError(true);
      setModel(null);
    } finally {
      setLoading(false);
    }
  }, [patientId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const onRefresh = () => void refresh();
    window.addEventListener("focus", onRefresh);
    document.addEventListener("visibilitychange", onRefresh);
    return () => {
      window.removeEventListener("focus", onRefresh);
      document.removeEventListener("visibilitychange", onRefresh);
    };
  }, [refresh]);

  return { model, loading, error, refresh };
}
