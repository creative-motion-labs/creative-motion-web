import { Pr313FloatingNav } from "@/app/components/qa/Pr313FloatingNav";

export default function PatientAssessmentLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <Pr313FloatingNav variant="ulms" />
    </>
  );
}
