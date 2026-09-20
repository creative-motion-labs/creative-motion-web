import Link from "next/link";
import type { ReactNode } from "react";

type VolunteerWizardShellProps = {
  children: ReactNode;
  stepLabel?: string;
};

export function VolunteerWizardShell({ children, stepLabel }: VolunteerWizardShellProps) {
  return (
    <div
      className="flex min-h-screen flex-col bg-[#F4F6F5] text-[#374151]"
      style={{ fontFamily: "var(--font-inter, ui-sans-serif, system-ui, sans-serif)" }}
    >
      <header className="border-b border-[#E2E8E5] bg-white px-6 py-4">
        <div className="mx-auto flex max-w-2xl items-center justify-between">
          <Link href="/" className="text-[13px] font-bold tracking-[0.14em] text-[#0A0F1A]">
            RASQ
          </Link>
          {stepLabel ? (
            <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-[#9CA3AF]">
              {stepLabel}
            </span>
          ) : null}
        </div>
      </header>

      <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-10">{children}</main>

      <footer className="border-t border-[#E2E8E5] bg-white px-6 py-4">
        <p className="mx-auto max-w-2xl text-center text-[11px] text-[#9CA3AF]">
          Technical movement-data collection — not medical care.{" "}
          <Link href="/privacy" className="underline hover:text-[#6B7280]">
            Privacy
          </Link>
        </p>
      </footer>
    </div>
  );
}
