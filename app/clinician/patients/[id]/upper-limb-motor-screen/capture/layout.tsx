import { Pr313FloatingNav } from "@/app/components/qa/Pr313FloatingNav";

export default function CaptureLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <Pr313FloatingNav variant="capture" />
    </>
  );
}
