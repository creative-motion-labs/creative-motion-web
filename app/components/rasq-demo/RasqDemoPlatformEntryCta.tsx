import Link from "next/link";
import {
  RASQ_DEMO_PLATFORM_ENTRY_CTA_LABEL,
  RASQ_DEMO_PLATFORM_ENTRY_HREF,
  RASQ_DEMO_PLATFORM_ENTRY_SUPPORT_COPY,
} from "@/app/lib/rasq-demo/demo-copy";

type RasqDemoPlatformEntryCtaProps = {
  variant?: "hero" | "login";
};

export function RasqDemoPlatformEntryCta({ variant = "hero" }: RasqDemoPlatformEntryCtaProps) {
  if (variant === "login") {
    return (
      <div className="mt-6 rounded-[10px] border border-[#1E2D42] bg-[#0F1825] p-5 text-center">
        <Link
          href={RASQ_DEMO_PLATFORM_ENTRY_HREF}
          className="inline-flex w-full items-center justify-center rounded-[7px] border border-[#1D9E75]/35 bg-[#1D9E75]/10 px-4 py-3 text-sm font-semibold text-white transition hover:border-[#1D9E75]/55 hover:bg-[#1D9E75]/16"
        >
          {RASQ_DEMO_PLATFORM_ENTRY_CTA_LABEL}
        </Link>
        <p className="mt-3 text-xs leading-5 text-white/40">{RASQ_DEMO_PLATFORM_ENTRY_SUPPORT_COPY}</p>
      </div>
    );
  }

  return (
    <div className="rounded-[10px] border border-[var(--rasq-border)] bg-[var(--rasq-base)] p-5 sm:p-6">
      <Link
        href={RASQ_DEMO_PLATFORM_ENTRY_HREF}
        className="inline-flex w-full items-center justify-center rounded-[var(--rasq-r-btn)] bg-[var(--rasq-teal)] px-6 py-2.5 text-sm font-medium text-white transition hover:bg-[#179165] sm:w-auto"
      >
        {RASQ_DEMO_PLATFORM_ENTRY_CTA_LABEL}
      </Link>
      <p className="mt-3 max-w-lg text-xs leading-5 text-white/40 sm:text-sm sm:leading-6">
        {RASQ_DEMO_PLATFORM_ENTRY_SUPPORT_COPY}
      </p>
    </div>
  );
}
