"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import type { PatientPlanData } from "@/app/api/patient/plan/route";
import type { PatientExerciseLanguage } from "@/app/lib/exercise-resolve";
import {
  normalizeApiPatientLanguage,
  readStoredPatientLanguage,
  writeStoredPatientLanguage,
} from "@/app/lib/patient-language-preference";
import { dispatchPatientPortalRefresh } from "@/app/lib/patient-portal-refresh";
import { portalTextDir } from "@/app/lib/patient-portal-ui";
import { patientPortalArabicSurfaceClass } from "@/app/lib/rasq-typography";

type PatientPortalContextValue = {
  plan: PatientPlanData | null | undefined;
  planLoadError: "load" | "connection" | "";
  language: PatientExerciseLanguage;
  setLanguage: (language: PatientExerciseLanguage) => void;
  assignedBy: string;
  isArabic: boolean;
  textDir: "rtl" | "ltr";
  arClass: string;
  isPlanLoading: boolean;
  isRefreshingPlan: boolean;
  refreshPlan: () => Promise<boolean>;
};

const PatientPortalContext = createContext<PatientPortalContextValue | null>(null);

export function PatientLanguageProvider({
  token,
  children,
}: {
  token: string;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [plan, setPlan] = useState<PatientPlanData | null | undefined>(undefined);
  const [planLoadError, setPlanLoadError] = useState<"load" | "connection" | "">("");
  const [isRefreshingPlan, setIsRefreshingPlan] = useState(false);
  const [language, setLanguageState] = useState<PatientExerciseLanguage>("en");
  const [assignedBy, setAssignedBy] = useState("");

  const refreshPlan = useCallback(async (): Promise<boolean> => {
    if (!token) return false;

    setIsRefreshingPlan(true);
    try {
      const res = await fetch(`/api/patient/plan?token=${encodeURIComponent(token)}`);
      if (res.status === 404 || res.status === 403) {
        router.replace("/patient/invalid");
        return false;
      }
      if (!res.ok) {
        setPlanLoadError("load");
        return false;
      }

      const data = (await res.json()) as PatientPlanData;
      setPlan(data);
      setPlanLoadError("");
      if (data.assignedBy) setAssignedBy(data.assignedBy);
      dispatchPatientPortalRefresh();
      return true;
    } catch {
      setPlanLoadError("connection");
      return false;
    } finally {
      setIsRefreshingPlan(false);
    }
  }, [token, router]);

  useEffect(() => {
    if (!token) {
      router.replace("/patient/invalid");
      return;
    }

    const stored = readStoredPatientLanguage(token);
    if (stored) {
      setLanguageState(stored);
    }

    setPlan(undefined);
    setPlanLoadError("");

    fetch(`/api/patient/plan?token=${encodeURIComponent(token)}`)
      .then(async (res) => {
        if (res.status === 404 || res.status === 403) {
          router.replace("/patient/invalid");
          return;
        }
        if (!res.ok) {
          setPlanLoadError("load");
          setPlan(null);
          return;
        }
        const data = (await res.json()) as PatientPlanData;
        setPlan(data);
        if (data.assignedBy) setAssignedBy(data.assignedBy);
        if (!readStoredPatientLanguage(token)) {
          setLanguageState(normalizeApiPatientLanguage(data.patientLanguage));
        }
      })
      .catch(() => {
        setPlanLoadError("connection");
        setPlan(null);
      });
  }, [token, router]);

  const setLanguage = useCallback(
    (next: PatientExerciseLanguage) => {
      if (token) writeStoredPatientLanguage(token, next);
      setLanguageState(next);
    },
    [token],
  );

  const isArabic = language === "ar";
  const textDir = portalTextDir(language);
  const arClass = patientPortalArabicSurfaceClass(isArabic);
  const isPlanLoading = plan === undefined;

  const value = useMemo(
    () => ({
      plan,
      planLoadError,
      language,
      setLanguage,
      assignedBy,
      isArabic,
      textDir,
      arClass,
      isPlanLoading,
      isRefreshingPlan,
      refreshPlan,
    }),
    [
      plan,
      planLoadError,
      language,
      setLanguage,
      assignedBy,
      isArabic,
      textDir,
      arClass,
      isPlanLoading,
      isRefreshingPlan,
      refreshPlan,
    ],
  );

  return (
    <PatientPortalContext.Provider value={value}>
      {children}
    </PatientPortalContext.Provider>
  );
}

export function usePatientPlan(): PatientPortalContextValue {
  const context = useContext(PatientPortalContext);
  if (!context) {
    throw new Error("usePatientPlan must be used within PatientLanguageProvider");
  }
  return context;
}

export function usePatientLanguage(): Pick<
  PatientPortalContextValue,
  "language" | "setLanguage" | "assignedBy" | "isArabic" | "textDir" | "arClass"
> {
  const { language, setLanguage, assignedBy, isArabic, textDir, arClass } = usePatientPlan();
  return { language, setLanguage, assignedBy, isArabic, textDir, arClass };
}
