import type { Metadata } from "next";
import { RasqDemoExperience } from "@/app/components/rasq-demo/RasqDemoExperience";
import { RASQ_DEMO_MOVEMENT_DISCLAIMER, RASQ_DEMO_PAGE_TITLE } from "@/app/lib/rasq-demo/demo-copy";

export const metadata: Metadata = {
  title: RASQ_DEMO_PAGE_TITLE,
  description: RASQ_DEMO_MOVEMENT_DISCLAIMER,
};

export default function RasqDemoPage() {
  return (
    <main className="min-h-screen bg-[#F1F5F9]">
      <RasqDemoExperience />
    </main>
  );
}
