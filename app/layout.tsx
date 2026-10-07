import type { Metadata } from "next";
import { rasqFontVariables } from "./fonts";
import "./globals.css";

/* ── Metadata ─────────────────────────────────────────────────────────────── */

export const metadata: Metadata = {
  title: "RASQ — Rehabilitation, precisely.",
  description:
    "RASQ by Creative Motion Lab — clinic-led remote rehabilitation platform. Assess patients, assign plans, track adherence, and export clinical reports.",
  openGraph: {
    title: "RASQ — Rehabilitation, precisely.",
    description:
      "RASQ by Creative Motion Lab — clinic-led remote rehabilitation platform. Assess patients, assign plans, track adherence, and export clinical reports.",
  },
};

/* ── Root layout ──────────────────────────────────────────────────────────── */

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`h-full antialiased ${rasqFontVariables}`}>
      <body className="font-ui-en min-h-full flex flex-col bg-[#080E14] text-[#e8edf2]">
        {children}
      </body>
    </html>
  );
}
