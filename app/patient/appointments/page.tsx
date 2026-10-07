"use client";

import Link from "next/link";
import { useState } from "react";
import { LegacyDemoGate } from "@/app/components/legacy/LegacyDemoGate";

// ── Types ─────────────────────────────────────────────────────────────────────
type ApptKind   = "video" | "in-clinic" | "assessment-visit";
type ApptStatus = "upcoming" | "live" | "completed" | "cancelled";

interface Appointment {
  id: string;
  title: string;
  kind: ApptKind;
  date: string;
  isoDate: string;
  time: string;
  duration: string;
  clinician: string;
  status: ApptStatus;
  meetingUrl: string | null;
  notes: string | null;
  location: string | null;
}

// ── Mock data ─────────────────────────────────────────────────────────────────
const APPOINTMENTS: Appointment[] = [
  {
    id: "a1",
    title: "Progress Review",
    kind: "video",
    date: "Thu, 22 May 2026",
    isoDate: "2026-05-22",
    time: "4:00 PM",
    duration: "30 min",
    clinician: "Dr. James Mitchell",
    status: "upcoming",
    meetingUrl: null,
    notes: "Your therapist will review Phase 2 metrics and discuss next steps. Have your phone or laptop camera ready.",
    location: null,
  },
  {
    id: "a2",
    title: "Phase 2 Assessment Visit",
    kind: "assessment-visit",
    date: "Mon, 2 Jun 2026",
    isoDate: "2026-06-02",
    time: "10:00 AM",
    duration: "60 min",
    clinician: "Dr. James Mitchell",
    status: "upcoming",
    meetingUrl: null,
    notes: "Wear comfortable training clothes. Knee brace optional. Arrive 5 minutes early.",
    location: "RASQ Clinic — Room 3, Level 2",
  },
  {
    id: "a3",
    title: "Phase 1 Assessment Visit",
    kind: "assessment-visit",
    date: "Fri, 2 May 2026",
    isoDate: "2026-05-02",
    time: "11:00 AM",
    duration: "45 min",
    clinician: "Dr. James Mitchell",
    status: "completed",
    meetingUrl: null,
    notes: null,
    location: "RASQ Clinic",
  },
  {
    id: "a4",
    title: "Initial Intake Consultation",
    kind: "video",
    date: "Mon, 28 Apr 2026",
    isoDate: "2026-04-28",
    time: "2:00 PM",
    duration: "45 min",
    clinician: "Dr. James Mitchell",
    status: "completed",
    meetingUrl: null,
    notes: null,
    location: null,
  },
];

// ── Kind metadata ─────────────────────────────────────────────────────────────
const KIND_META: Record<ApptKind, {
  label: string;
  iconBg: string;
  iconColor: string;
  badge: string;
  badgeText: string;
  dot: string;
}> = {
  "video": {
    label: "Video Consultation",
    iconBg: "bg-amber-50 border-amber-200",
    iconColor: "text-amber-600",
    badge: "bg-amber-50 border-amber-200",
    badgeText: "text-amber-700",
    dot: "bg-amber-400",
  },
  "in-clinic": {
    label: "Clinic Visit",
    iconBg: "bg-violet-50 border-violet-200",
    iconColor: "text-violet-600",
    badge: "bg-violet-50 border-violet-200",
    badgeText: "text-violet-700",
    dot: "bg-violet-400",
  },
  "assessment-visit": {
    label: "Assessment Visit",
    iconBg: "bg-[#E8F5F1] border-[#d0e8de]",
    iconColor: "text-[#1D9E75]",
    badge: "bg-[#E8F5F1] border-[#d0e8de]",
    badgeText: "text-[#1D9E75]",
    dot: "bg-[#1D9E75]",
  },
};

const STATUS_BADGE: Record<ApptStatus, { bg: string; text: string; label: string }> = {
  upcoming:  { bg: "bg-[#F4F6F5] border-[#e4ece8]",    text: "text-[#4a7060]",   label: "Upcoming"   },
  live:      { bg: "bg-emerald-50 border-emerald-200",  text: "text-emerald-700", label: "Live Now"   },
  completed: { bg: "bg-[#F4F6F5] border-[#e4ece8]",    text: "text-[#9db0a3]",   label: "Completed"  },
  cancelled: { bg: "bg-rose-50 border-rose-200",        text: "text-rose-700",    label: "Cancelled"  },
};

// ── Icons ─────────────────────────────────────────────────────────────────────
const KIND_ICON: Record<ApptKind, React.ReactNode> = {
  "video": (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25h-9A2.25 2.25 0 002.25 7.5v9a2.25 2.25 0 002.25 2.25z" />
    </svg>
  ),
  "in-clinic": (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 21h19.5m-18-18v18m10.5-18v18m6-13.5V21M6.75 6.75h.75m-.75 3h.75m-.75 3h.75m3-6h.75m-.75 3h.75m-.75 3h.75M6.75 21v-3.375c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21M3 3h12m-.75 4.5H21m-3.75 3.75h.008v.008h-.008v-.008zm0 3h.008v.008h-.008v-.008zm0 3h.008v.008h-.008v-.008z" />
    </svg>
  ),
  "assessment-visit": (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25z" />
    </svg>
  ),
};

// ── Appointment card ───────────────────────────────────────────────────────────
function AppointmentCard({ appt }: { appt: Appointment }) {
  const meta      = KIND_META[appt.kind];
  const statusCfg = STATUS_BADGE[appt.status];
  const isUpcoming = appt.status === "upcoming" || appt.status === "live";

  return (
    <div className={`overflow-hidden rounded-[10px] border transition ${
      isUpcoming
        ? "border-[#e4ece8] bg-white"
        : "border-[#e4ece8] bg-[#F4F6F5] opacity-65"
    }`}>
      <div className="p-5">
        <div className="flex items-start gap-4">
          {/* Kind icon */}
          <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-[8px] border ${
            isUpcoming ? `${meta.iconBg} ${meta.iconColor}` : "border-[#e4ece8] bg-[#F4F6F5] text-[#9db0a3]"
          }`}>
            {KIND_ICON[appt.kind]}
          </div>

          <div className="flex-1 min-w-0">
            {/* Kind + status row */}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className={`rounded-[5px] border px-2.5 py-0.5 text-[10px] font-semibold ${
                isUpcoming ? `${meta.badge} ${meta.badgeText}` : "border-[#e4ece8] bg-[#F4F6F5] text-[#9db0a3]"
              }`}>
                {meta.label}
              </span>
              <span className={`rounded-[5px] border px-2.5 py-0.5 text-[10px] font-semibold ${statusCfg.bg} ${statusCfg.text}`}>
                {statusCfg.label}
              </span>
            </div>

            {/* Title */}
            <h3 className={`mt-2 text-base font-bold ${isUpcoming ? "text-[#0f2e22]" : "text-[#6b9080]"}`}>
              {appt.title}
            </h3>

            {/* Date / time / clinician grid */}
            <div className="mt-3 space-y-1.5 text-sm">
              <div className="flex items-center gap-2 text-[#4a7060]">
                <svg className="h-3.5 w-3.5 shrink-0 text-[#9db0a3]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 9v7.5" />
                </svg>
                <span className={`font-semibold ${isUpcoming ? "text-[#0f2e22]" : "text-[#6b9080]"}`}>{appt.date}</span>
              </div>
              <div className="flex items-center gap-2 text-[#6b9080]">
                <svg className="h-3.5 w-3.5 shrink-0 text-[#9db0a3]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span>{appt.time} · {appt.duration}</span>
              </div>
              <div className="flex items-center gap-2 text-[#6b9080]">
                <svg className="h-3.5 w-3.5 shrink-0 text-[#9db0a3]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
                </svg>
                <span>{appt.clinician}</span>
              </div>
              {appt.location && (
                <div className="flex items-center gap-2 text-[#6b9080]">
                  <svg className="h-3.5 w-3.5 shrink-0 text-[#9db0a3]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0zM19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" />
                  </svg>
                  <span>{appt.location}</span>
                </div>
              )}
            </div>

            {/* Pre-visit note */}
            {appt.notes && isUpcoming && (
              <p className="mt-3 rounded-[6px] border border-[#e4ece8] bg-[#F4F6F5] px-3 py-2.5 text-xs leading-5 text-[#6b9080]">
                {appt.notes}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* CTAs */}
      {isUpcoming && (
        <div className="border-t border-[#e4ece8] px-5 py-3">
          {appt.kind === "video" && (
            appt.meetingUrl ? (
              <a
                href={appt.meetingUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex w-full items-center justify-center gap-2 rounded-[8px] bg-amber-500 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-amber-600"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25h-9A2.25 2.25 0 002.25 7.5v9a2.25 2.25 0 002.25 2.25z" />
                </svg>
                Join Meeting
              </a>
            ) : (
              <div className="flex items-center justify-between rounded-[8px] border border-amber-200 bg-amber-50 px-4 py-3">
                <div>
                  <p className="text-sm font-semibold text-amber-800">Join Meeting</p>
                  <p className="mt-0.5 text-xs text-amber-700/70">Your therapist will share the link before the session.</p>
                </div>
                <span className="rounded-[5px] border border-amber-300 bg-amber-100 px-2.5 py-1 text-[10px] font-semibold text-amber-700">
                  Zoom / Meet
                </span>
              </div>
            )
          )}

          {appt.kind === "in-clinic" && appt.location && (
            <div className="flex items-center justify-between rounded-[8px] border border-violet-200 bg-violet-50 px-4 py-3">
              <div>
                <p className="text-sm font-semibold text-violet-800">In-Clinic Visit</p>
                <p className="mt-0.5 text-xs text-violet-700/70">{appt.location}</p>
              </div>
              <span className="rounded-[5px] border border-violet-300 bg-violet-100 px-2.5 py-1 text-[10px] font-semibold text-violet-700">
                Directions ↗
              </span>
            </div>
          )}

          {appt.kind === "assessment-visit" && (
            <div className="flex items-center justify-between rounded-[8px] border border-[#d0e8de] bg-[#E8F5F1] px-4 py-3">
              <div>
                <p className="text-sm font-semibold text-[#0f2e22]">Assessment Visit</p>
                <p className="mt-0.5 text-xs text-[#6b9080]">
                  {appt.location
                    ? `In-clinic · ${appt.location}`
                    : "Your therapist will confirm the session format before the visit."}
                </p>
              </div>
              <span className="rounded-[5px] border border-[#d0e8de] bg-white px-2.5 py-1 text-[10px] font-semibold text-[#1D9E75]">
                Confirmed
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Past appointments toggle ───────────────────────────────────────────────────
function PastAppointments({ appts }: { appts: Appointment[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 text-sm font-medium text-[#9db0a3] transition hover:text-[#4a7060]"
      >
        <svg className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
        {open ? "Hide" : "Show"} past appointments ({appts.length})
      </button>
      {open && (
        <div className="mt-4 space-y-3">
          {appts.map((a) => <AppointmentCard key={a.id} appt={a} />)}
        </div>
      )}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function PatientAppointmentsPage() {
  return (
    <LegacyDemoGate>
      <PatientAppointmentsPageContent />
    </LegacyDemoGate>
  );
}

function PatientAppointmentsPageContent() {
  const upcoming = APPOINTMENTS
    .filter((a) => a.status === "upcoming" || a.status === "live")
    .sort((a, b) => a.isoDate.localeCompare(b.isoDate));

  const past = APPOINTMENTS
    .filter((a) => a.status === "completed" || a.status === "cancelled")
    .sort((a, b) => b.isoDate.localeCompare(a.isoDate));

  return (
    <main className="font-ui-en min-h-screen bg-[#F4F6F5]">

      <div className="border-b border-amber-200 bg-amber-50 px-6 py-3 text-center">
        <p className="text-sm font-medium text-amber-900">
          ⚠️ This is a demo page for illustration only. If you are a patient, please use the secure link provided by your clinic.
        </p>
      </div>

      {/* Page header */}
      <div className="border-b border-[#e4ece8] bg-white px-6 py-5">
        <div className="mx-auto max-w-3xl">
          <Link href="/patient" className="text-xs font-semibold text-[#6b9080] transition hover:text-[#1D9E75]">← Dashboard</Link>

          <div className="mt-3 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h1
                className="text-xl font-bold text-[#0f2e22]"
              >
                Appointments
              </h1>
              <p className="mt-0.5 text-sm text-[#6b9080]">
                Your scheduled visits and consultations with Dr. James Mitchell.
              </p>
            </div>

            <div className="flex shrink-0 items-center gap-3">
              <div className="rounded-[8px] border border-amber-200 bg-amber-50 px-4 py-2.5 text-center">
                <p className="text-lg font-bold text-amber-700" style={{ fontFamily: "var(--font-ibm-plex-mono, monospace)" }}>
                  {upcoming.length}
                </p>
                <p className="text-[11px] text-amber-700/70">Upcoming</p>
              </div>
              <div className="rounded-[8px] border border-[#e4ece8] bg-[#F4F6F5] px-4 py-2.5 text-center">
                <p className="text-lg font-bold text-[#9db0a3]" style={{ fontFamily: "var(--font-ibm-plex-mono, monospace)" }}>
                  {past.length}
                </p>
                <p className="text-[11px] text-[#9db0a3]">Past</p>
              </div>
            </div>
          </div>

          {/* Type legend */}
          <div className="mt-4 flex flex-wrap gap-4">
            {(["video", "in-clinic", "assessment-visit"] as ApptKind[]).map((kind) => (
              <div key={kind} className="flex items-center gap-1.5">
                <span className={`h-2 w-2 rounded-full ${KIND_META[kind].dot}`} />
                <span className="text-xs text-[#6b9080]">{KIND_META[kind].label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Appointments */}
      <div className="mx-auto max-w-3xl px-6 py-6">
        <h2 className="mb-4 text-sm font-bold text-[#0f2e22]">Upcoming</h2>

        {upcoming.length > 0 ? (
          <div className="space-y-3">
            {upcoming.map((a) => <AppointmentCard key={a.id} appt={a} />)}
          </div>
        ) : (
          <div className="rounded-[10px] border border-[#e4ece8] bg-white px-8 py-12 text-center">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-[8px] border border-[#e4ece8] bg-[#F4F6F5]">
              <svg className="h-5 w-5 text-[#9db0a3]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 9v7.5" />
              </svg>
            </div>
            <p className="text-sm font-semibold text-[#4a7060]">No upcoming appointments</p>
            <p className="mt-1.5 text-xs text-[#9db0a3]">Your therapist will schedule the next consultation when needed.</p>
          </div>
        )}

        {past.length > 0 && <PastAppointments appts={past} />}

        {/* Sessions cross-link */}
        <div className="mt-8 flex items-center justify-between rounded-[10px] border border-[#e4ece8] bg-white px-5 py-4">
          <div>
            <p className="text-sm font-medium text-[#4a7060]">Looking for your rehabilitation exercises?</p>
            <p className="mt-0.5 text-xs text-[#9db0a3]">Camera-based sessions are available any time in Sessions.</p>
          </div>
          <Link
            href="/patient/sessions"
            className="shrink-0 rounded-[7px] border border-[#e4ece8] bg-[#F4F6F5] px-4 py-2 text-xs font-semibold text-[#4a7060] transition hover:bg-[#E8F5F1] hover:text-[#1D9E75]"
          >
            Sessions →
          </Link>
        </div>
      </div>
    </main>
  );
}
