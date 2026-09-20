"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";

function useReveal(threshold = 0.15) {
  const ref = useRef<HTMLElement>(null);
  const [revealed, setRevealed] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          setRevealed(true);
          io.disconnect();
        }
      },
      { threshold }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [threshold]);
  return [ref, revealed] as const;
}

function ArcMark({ size = 20, animate = false }: { size?: number; animate?: boolean }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden="true"
      className="shrink-0"
    >
      <path
        d="M10 2C5.582 2 2 5.582 2 10s3.582 8 8 8"
        stroke="var(--rasq-teal, #1D9E75)"
        strokeWidth="2.2"
        strokeLinecap="round"
        className={animate ? "rasq-arc-outer" : ""}
      />
      <path
        d="M10 5.5C7.515 5.5 5.5 7.515 5.5 10S7.515 14.5 10 14.5"
        stroke="var(--rasq-mint, #5DCAA5)"
        strokeWidth="1.8"
        strokeLinecap="round"
        className={animate ? "rasq-arc-inner" : ""}
      />
      <circle
        cx="10"
        cy="10"
        r="1.5"
        fill="var(--rasq-teal, #1D9E75)"
        className={animate ? "rasq-arc-dot" : ""}
      />
    </svg>
  );
}

function ChevronIcon({ muted = false }: { muted?: boolean }) {
  return (
    <svg
      className={`h-4 w-4 transition ${muted ? "text-white/15 group-hover:text-white/40" : "text-white/20 group-hover:text-[#5DCAA5]/60"}`}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
      aria-hidden="true"
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
    </svg>
  );
}

/**
 * Abstract movement arc — a single geometric curve suggesting a guided
 * shoulder-reach path. Deliberately NOT anatomical: no joints, no skeleton,
 * no pose-estimation-style points. Brand teal only.
 */
function MovementArc({ className = "" }: { className?: string }) {
  return (
    <svg
      className={`pointer-events-none absolute inset-0 h-full w-full ${className}`}
      viewBox="0 0 400 300"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M120 230C120 230 150 120 240 90C300 70 340 100 350 130"
        stroke="var(--rasq-mint, #5DCAA5)"
        strokeWidth="2"
        strokeLinecap="round"
        opacity="0.55"
      />
      <circle cx="120" cy="230" r="4" fill="var(--rasq-teal, #1D9E75)" opacity="0.7" />
      <circle cx="350" cy="130" r="4" fill="var(--rasq-mint, #5DCAA5)" opacity="0.85" />
    </svg>
  );
}

/**
 * Graded placeholder for real RASQ rehabilitation photography.
 *
 * No stock or decorative photo is embedded here — sourcing/licensing a real
 * photograph of a person for a healthcare brand's public site is a decision
 * outside what can be made unilaterally in this pass. This component is the
 * exact crop, grade, and motion treatment the real asset drops into
 * unchanged: replace the empty frame's background with the licensed image
 * and everything layered on top of it (UI card, arc, copy) stays correct.
 */
function PhotoFrame({
  children,
  className = "",
  drift = false,
}: {
  children?: React.ReactNode;
  className?: string;
  drift?: boolean;
}) {
  return (
    <div className={`rasq-photo-frame relative rounded-[var(--rasq-r-lg)] border border-[var(--rasq-border)] ${className}`}>
      <div className={`absolute inset-0 ${drift ? "rasq-photo-drift" : ""}`} aria-hidden="true" />
      {children}
    </div>
  );
}

function Navbar() {
  return (
    <header className="sticky top-0 z-50 border-b border-[var(--rasq-border)] bg-[var(--rasq-void)]/95">
      <div className="mx-auto flex h-[52px] max-w-6xl items-center justify-between px-6">
        <Link href="/" className="flex items-center gap-2.5">
          <ArcMark size={20} animate />
          <span
            className="text-[15px] font-semibold tracking-[-0.02em] text-white"
            style={{ fontFamily: "var(--rasq-font-display)" }}
          >
            RASQ
          </span>
        </Link>

        <nav className="hidden items-center gap-1 md:flex" aria-label="Primary">
          {(
            [
              ["Platform", "#platform"],
              ["Providers", "#providers"],
              ["Patients", "#patients"],
            ] as [string, string][]
          ).map(([label, href]) => (
            <a
              key={label}
              href={href}
              className="rounded-[var(--rasq-r-btn)] px-3.5 py-2 text-sm text-white/50 transition-colors hover:text-white"
            >
              {label}
            </a>
          ))}
        </nav>

        <Link
          href="/login"
          className="rounded-[var(--rasq-r-btn)] border border-[var(--rasq-border)] px-4 py-2 text-sm font-medium text-white transition hover:border-[var(--rasq-teal)]/35"
        >
          Sign in
        </Link>
      </div>
    </header>
  );
}

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return reduced;
}

function AmbientTravelNode({
  pathId,
  duration,
  begin = 0,
  tone = "teal",
  reducedMotion,
  staticCx,
  staticCy,
}: {
  pathId: string;
  duration: number;
  begin?: number;
  tone?: "teal" | "mint";
  reducedMotion: boolean;
  staticCx: number;
  staticCy: number;
}) {
  if (reducedMotion) {
    return (
      <circle
        cx={staticCx}
        cy={staticCy}
        r="1.5"
        className={`rasq-ambient-node rasq-ambient-node--static rasq-ambient-node--${tone}`}
      />
    );
  }

  return (
    <circle r="1.5" className={`rasq-ambient-node rasq-ambient-node--${tone}`}>
      <animateMotion
        dur={`${duration}s`}
        repeatCount="indefinite"
        begin={`${begin}s`}
        rotate="auto"
        calcMode="spline"
        keyTimes="0;0.5;1"
        keySplines="0.42 0 0.2 1; 0.42 0 0.2 1"
      >
        <mpath href={`#${pathId}`} />
      </animateMotion>
      <animate
        attributeName="opacity"
        values="0;0.34;0.34;0"
        keyTimes="0;0.1;0.9;1"
        dur={`${duration}s`}
        repeatCount="indefinite"
        begin={`${begin}s`}
      />
    </circle>
  );
}

function PageAmbientLines() {
  const reducedMotion = usePrefersReducedMotion();

  return (
    <div className="rasq-page-ambient" aria-hidden="true">
      <svg
        className="rasq-page-ambient__svg"
        viewBox="0 0 1440 5200"
        preserveAspectRatio="xMidYMin slice"
        fill="none"
      >
        <defs>
          <filter id="rasq-ambient-node-soft" x="-100%" y="-100%" width="300%" height="300%">
            <feGaussianBlur stdDeviation="0.45" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Hero — active linework */}
        <g className="rasq-ambient-flow rasq-ambient-flow--a">
          <path
            id="rasq-ambient-path-hero-a"
            className="rasq-ambient-line"
            d="M-40 120 C 220 40, 420 260, 680 180 S 1180 60, 1520 220"
          />
          <path
            id="rasq-ambient-path-hero-b"
            className="rasq-ambient-line rasq-ambient-line--mint"
            d="M120 420 C 360 320, 520 540, 780 460 S 1120 340, 1480 500"
          />
          <AmbientTravelNode
            pathId="rasq-ambient-path-hero-a"
            duration={14}
            begin={0}
            tone="teal"
            reducedMotion={reducedMotion}
            staticCx={680}
            staticCy={180}
          />
          <AmbientTravelNode
            pathId="rasq-ambient-path-hero-b"
            duration={16}
            begin={5}
            tone="mint"
            reducedMotion={reducedMotion}
            staticCx={780}
            staticCy={460}
          />
        </g>
        <g className="rasq-ambient-flow rasq-ambient-flow--b">
          <path
            className="rasq-ambient-line"
            d="M80 760 C 300 660, 480 880, 740 780 S 1080 640, 1420 820"
          />
        </g>

        {/* Trust / workflow — sparse */}
        <g className="rasq-ambient-flow rasq-ambient-flow--c rasq-ambient-zone--quiet">
          <path
            className="rasq-ambient-line rasq-ambient-line--mint"
            d="M960 1180 C 760 1080, 540 1280, 320 1180 S -40 1020, -120 1120"
          />
        </g>

        {/* Guided rehabilitation — medium */}
        <g className="rasq-ambient-flow rasq-ambient-flow--d rasq-ambient-zone--medium">
          <path
            id="rasq-ambient-path-guided-a"
            className="rasq-ambient-line"
            d="M-60 2100 C 180 1980, 420 2220, 700 2100 S 1140 1940, 1480 2080"
          />
          <path
            className="rasq-ambient-line rasq-ambient-line--mint"
            d="M200 2480 C 440 2360, 620 2580, 900 2460 S 1280 2300, 1520 2440"
          />
          <AmbientTravelNode
            pathId="rasq-ambient-path-guided-a"
            duration={12}
            begin={2}
            tone="teal"
            reducedMotion={reducedMotion}
            staticCx={700}
            staticCy={2100}
          />
        </g>

        {/* Progress / access — quiet again */}
        <g className="rasq-ambient-flow rasq-ambient-flow--e rasq-ambient-zone--quiet">
          <path
            className="rasq-ambient-line"
            d="M1180 3020 C 980 2920, 720 3140, 480 3040 S 120 2880, -80 2980"
          />
        </g>

        {/* Capabilities — lines return */}
        <g className="rasq-ambient-flow rasq-ambient-flow--f">
          <path
            id="rasq-ambient-path-cap-a"
            className="rasq-ambient-line rasq-ambient-line--mint"
            d="M-40 3680 C 220 3560, 460 3800, 740 3680 S 1120 3520, 1500 3660"
          />
          <path
            className="rasq-ambient-line"
            d="M140 4040 C 380 3920, 560 4140, 820 4020 S 1180 3860, 1460 4000"
          />
          <AmbientTravelNode
            pathId="rasq-ambient-path-cap-a"
            duration={15}
            begin={7}
            tone="mint"
            reducedMotion={reducedMotion}
            staticCx={740}
            staticCy={3680}
          />
        </g>

        {/* Footer approach — fading */}
        <g className="rasq-ambient-flow rasq-ambient-flow--g rasq-ambient-zone--quiet">
          <path
            className="rasq-ambient-line rasq-ambient-line--mint"
            d="M900 4620 C 700 4520, 460 4740, 220 4640 S -120 4480, -200 4580"
          />
        </g>
      </svg>
    </div>
  );
}

function HeroPreview() {
  return (
    <div className="relative mx-auto w-full max-w-[420px] lg:max-w-none">
      <div
        className="rasq-hero-ambient absolute -left-8 top-6 h-[360px] w-[360px] opacity-80 lg:-left-12 lg:top-0 lg:h-[440px] lg:w-[440px]"
        aria-hidden="true"
      />

      <div className="rasq-preview-stack relative">
        <div
          className="relative overflow-hidden rounded-[var(--rasq-r-lg)] border border-[var(--rasq-border)] bg-[var(--rasq-base)] shadow-[0_32px_64px_-40px_rgba(0,0,0,0.85)]"
          aria-hidden="true"
        >
          <div className="relative aspect-[4/5] w-full min-h-[320px] sm:min-h-[380px] lg:min-h-[440px]">
            <div className="absolute inset-0">
              <Image
                src="/images/futuristic_motion_tracking_portrait.png"
                alt=""
                fill
                priority
                sizes="(max-width: 1024px) 420px, 520px"
                className="object-cover object-[42%_38%]"
              />
            </div>
            <div
              className="pointer-events-none absolute inset-0 rounded-[var(--rasq-r-lg)]"
              style={{
                background:
                  "linear-gradient(180deg, color-mix(in srgb, var(--rasq-void) 18%, transparent) 0%, transparent 28%, transparent 72%, color-mix(in srgb, var(--rasq-void) 24%, transparent) 100%), linear-gradient(90deg, color-mix(in srgb, var(--rasq-void) 12%, transparent) 0%, transparent 18%, transparent 82%, color-mix(in srgb, var(--rasq-void) 16%, transparent) 100%)",
              }}
            />
            <div
              className="pointer-events-none absolute inset-0 rounded-[var(--rasq-r-lg)] ring-1 ring-inset ring-[var(--rasq-teal)]/10"
              aria-hidden="true"
            />
          </div>
        </div>
      </div>
    </div>
  );
}

const HERO_VALUES = [
  {
    label: "Structured assessments",
    desc: "In clinic or through secure remote links.",
  },
  {
    label: "Guided rehabilitation",
    desc: "Clinician-directed plans and guided sessions.",
  },
  {
    label: "Progress tracking",
    desc: "Session completion and adherence, reviewed by your therapist.",
  },
];

function HeroSection() {
  return (
    <section className="relative overflow-hidden bg-transparent" id="hero">
      <div className="mx-auto max-w-6xl px-6 py-16 lg:py-24">
        <div className="grid items-start gap-14 lg:grid-cols-[1.05fr_0.95fr] lg:gap-16">
          <div>
            <div
              className="rasq-stagger-item inline-flex items-center rounded-[6px] border border-[var(--rasq-border)] bg-[var(--rasq-base)] px-3 py-1.5"
              style={{ animationDelay: "0ms" }}
            >
              <span
                className="text-[10px] font-medium uppercase tracking-[0.12em] text-[var(--rasq-mint)]/75"
                style={{ fontFamily: "var(--rasq-font-mono)" }}
              >
                Clinic-led rehabilitation platform
              </span>
            </div>

            <h1
              className="rasq-stagger-item mt-6 max-w-xl text-[2.35rem] font-semibold leading-[1.08] tracking-[-0.025em] text-white lg:text-[2.85rem]"
              style={{
                animationDelay: "60ms",
                fontFamily: "var(--rasq-font-display)",
              }}
            >
              Rehabilitation, connected from assessment to progress.
            </h1>

            <p
              className="rasq-stagger-item mt-5 max-w-lg text-base leading-7 text-white/55"
              style={{ animationDelay: "120ms" }}
            >
              AI-assisted rehabilitation that helps clinicians assess, guide rehabilitation,
              and follow patient progress — with the clinician at the center of care.
            </p>

            <p
              className="rasq-stagger-item mt-4 text-sm font-medium tracking-[0.06em] text-white/30"
              style={{ animationDelay: "160ms" }}
            >
              Rehabilitation, precisely.
            </p>

            <div
              className="rasq-stagger-item mt-8 flex flex-wrap items-center gap-3"
              style={{ animationDelay: "200ms" }}
            >
              <Link
                href="/login?role=clinician"
                className="rounded-[var(--rasq-r-btn)] bg-[var(--rasq-teal)] px-6 py-2.5 text-sm font-medium text-white transition hover:bg-[#179165]"
              >
                For providers
              </Link>
              <a
                href="#patients"
                className="rounded-[var(--rasq-r-btn)] border border-[var(--rasq-border)] bg-[var(--rasq-base)] px-6 py-2.5 text-sm font-medium text-white/75 transition hover:border-[var(--rasq-teal)]/30 hover:text-white"
              >
                Patient access
              </a>
            </div>

            <div
              className="rasq-stagger-item mt-10 grid grid-cols-1 divide-y divide-[var(--rasq-border)] rounded-[10px] border border-[var(--rasq-border)] sm:grid-cols-3 sm:divide-x sm:divide-y-0"
              style={{ animationDelay: "240ms" }}
            >
              {HERO_VALUES.map(({ label, desc }) => (
                <div key={label} className="flex flex-col gap-1.5 bg-[var(--rasq-base)] px-5 py-4">
                  <span className="text-sm font-semibold text-white">{label}</span>
                  <span className="text-xs leading-5 text-white/40">{desc}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="rasq-stagger-item" style={{ animationDelay: "100ms" }}>
            <HeroPreview />
          </div>
        </div>
      </div>
    </section>
  );
}

function TrustBar() {
  const [ref, revealed] = useReveal(0.3);

  const items = [
    "Clinical workflows co-designed with rehabilitation specialists",
    "Secure clinic links — no public sign-up for remote assessments",
    "Export-ready clinical reports — structured for clinician review and referral",
  ];

  return (
    <section
      ref={ref as React.RefObject<HTMLElement>}
      className={`border-y border-[var(--rasq-border)] bg-[var(--rasq-card)]/82 rasq-reveal ${revealed ? "is-revealed" : ""}`}
    >
      <div className="mx-auto grid max-w-6xl grid-cols-1 divide-y divide-[var(--rasq-border)] px-6 py-0 md:grid-cols-3 md:divide-x md:divide-y-0">
        {items.map((text) => (
          <div key={text} className="px-6 py-5">
            <span className="text-sm leading-5 text-white/45">{text}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

const WORKFLOW_STEPS = [
  { num: "01", label: "Assess", desc: "Structured functional assessments — in clinic or through secure remote links." },
  { num: "02", label: "Plan", desc: "Prescribe rehabilitation plans and issue secure clinic access to patients." },
  { num: "03", label: "Track", desc: "Monitor guided sessions, adherence, and progress across the care pathway." },
  { num: "04", label: "Report", desc: "Export clinical reports structured for review, referral, and records." },
];

function WorkflowSection() {
  const [ref, revealed] = useReveal(0.2);

  return (
    <section
      id="platform"
      ref={ref as React.RefObject<HTMLElement>}
      className="bg-transparent py-16 lg:py-24"
    >
      <div className="mx-auto max-w-6xl px-6">
        <div className={`rasq-reveal ${revealed ? "is-revealed" : ""}`}>
          <p
            className="text-xs font-medium uppercase tracking-[0.12em] text-[var(--rasq-mint)]/75"
            style={{ fontFamily: "var(--rasq-font-mono)" }}
          >
            Platform
          </p>
          <h2
            className="mt-3 max-w-2xl text-2xl font-semibold tracking-tight text-white lg:text-[1.75rem]"
            style={{ fontFamily: "var(--rasq-font-display)" }}
          >
            One platform. Assessment through recovery.
          </h2>
          <p className="mt-3 max-w-xl text-sm leading-6 text-white/40">
            A connected workspace for assessment, plan assignment, session review,
            and export-ready reporting.
          </p>
        </div>

        <div
          className={`rasq-reveal-children mt-12 grid grid-cols-1 gap-8 sm:grid-cols-4 ${revealed ? "is-revealed" : ""}`}
        >
          {WORKFLOW_STEPS.map((step, i) => (
            <div key={step.num} className="relative flex flex-col">
              {i < WORKFLOW_STEPS.length - 1 && (
                <div
                  className={`rasq-connector absolute top-[22px] hidden h-px bg-[var(--rasq-border)] sm:block ${revealed ? "is-revealed" : ""}`}
                  style={{ width: "calc(100% - 44px)", left: "calc(50% + 22px)" }}
                />
              )}
              <div className="flex h-11 w-11 items-center justify-center rounded-[8px] border border-[var(--rasq-border)] bg-[var(--rasq-base)]">
                <span
                  className="text-xs font-medium text-[var(--rasq-mint)]"
                  style={{ fontFamily: "var(--rasq-font-mono)" }}
                >
                  {step.num}
                </span>
              </div>
              <p className="mt-3 text-sm font-medium text-white">{step.label}</p>
              <p className="mt-1.5 text-xs leading-5 text-white/40">{step.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function GuidedRehabilitationSection() {
  const [ref, revealed] = useReveal(0.15);

  return (
    <section
      ref={ref as React.RefObject<HTMLElement>}
      className="bg-transparent py-16 lg:py-24"
    >
      <div className="mx-auto max-w-6xl px-6">
        <div className={`grid items-start gap-12 lg:grid-cols-[0.9fr_1.1fr] lg:gap-16`}>
          <div className={`rasq-reveal ${revealed ? "is-revealed" : ""}`}>
            <p
              className="text-xs font-medium uppercase tracking-[0.12em] text-[var(--rasq-mint)]/75"
              style={{ fontFamily: "var(--rasq-font-mono)" }}
            >
              Guided rehabilitation
            </p>
            <h2
              className="mt-3 text-2xl font-semibold tracking-tight text-white lg:text-[1.75rem]"
              style={{ fontFamily: "var(--rasq-font-display)" }}
            >
              Guided movement. Clinician-reviewed progress.
            </h2>
            <p className="mt-4 max-w-md text-sm leading-6 text-white/45">
              Patients follow clinician-prescribed guided sessions while RASQ structures
              session information for therapist review and follow-up.
            </p>
          </div>

          <div
            className={`rasq-reveal relative ${revealed ? "is-revealed" : ""}`}
            style={{ transitionDelay: "100ms" }}
          >
            <PhotoFrame drift className="aspect-[16/10] w-full">
              <MovementArc className="opacity-80" />
            </PhotoFrame>

            <div
              className="absolute bottom-4 right-4 z-10 w-[62%] max-w-[240px] rounded-[var(--rasq-r-card)] border border-[var(--rasq-border)] bg-[var(--rasq-base)]/95 p-4 shadow-[0_20px_40px_-24px_rgba(0,0,0,0.8)] backdrop-blur-sm sm:bottom-6 sm:right-6"
              aria-hidden="true"
            >
              <div className="flex items-center justify-between">
                <span
                  className="text-[9px] font-medium uppercase tracking-[0.1em] text-white/30"
                  style={{ fontFamily: "var(--rasq-font-mono)" }}
                >
                  Clinical review
                </span>
                <span className="rounded-[5px] border border-[var(--rasq-teal)]/20 bg-[var(--rasq-teal)]/8 px-1.5 py-0.5 text-[8px] font-semibold uppercase tracking-[0.06em] text-[var(--rasq-mint)]/70">
                  Draft
                </span>
              </div>
              <ul className="mt-2.5 space-y-1.5">
                {["Session notes ready for review", "Adherence reviewed by clinician"].map((item) => (
                  <li key={item} className="flex gap-1.5">
                    <span className="mt-[5px] h-1 w-1 shrink-0 rounded-full bg-[var(--rasq-teal)]" aria-hidden="true" />
                    <span className="text-[10px] leading-4 text-white/55">{item}</span>
                  </li>
                ))}
              </ul>
            </div>

            <p className="relative z-10 mt-4 text-[11px] leading-5 text-white/30">
              Illustrative session — example UI overlay only, not a real patient record.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

const PROGRESS_TIMELINE = [
  { step: "Initial assessment", detail: "Structured functional assessment completed." },
  { step: "Plan assigned", detail: "Rehabilitation plan reviewed and assigned by clinician." },
  { step: "Guided sessions", detail: "Patient completes clinician-prescribed guided sessions." },
  { step: "Progress review", detail: "Adherence and session completion reviewed by therapist." },
  { step: "Follow-up assessment", detail: "Next structured assessment scheduled.", pending: true },
];

const REVIEW_ITEMS = [
  { signal: "Adherence", status: "On track", note: "Consistent session completion this phase." },
  { signal: "Session notes", status: "Ready for review", note: "Draft notes prepared for clinician sign-off." },
  { signal: "Plan progress", status: "On schedule", note: "Aligned with the assigned rehabilitation plan." },
];

function ProgressJourneySection() {
  const [ref, revealed] = useReveal(0.15);

  return (
    <section
      ref={ref as React.RefObject<HTMLElement>}
      className="bg-[var(--rasq-card)]/78 py-16 lg:py-24"
    >
      <div className="mx-auto max-w-6xl px-6">
        <div className={`rasq-reveal ${revealed ? "is-revealed" : ""}`}>
          <p
            className="text-xs font-medium uppercase tracking-[0.12em] text-[var(--rasq-mint)]/75"
            style={{ fontFamily: "var(--rasq-font-mono)" }}
          >
            Progress
          </p>
          <h2
            className="mt-3 max-w-2xl text-2xl font-semibold tracking-tight text-white lg:text-[1.75rem]"
            style={{ fontFamily: "var(--rasq-font-display)" }}
          >
            From assessment to ongoing progress.
          </h2>
          <p className="mt-3 max-w-lg text-sm leading-6 text-white/40">
            RASQ supports the clinician workflow from assessment through plan assignment
            and progress review — with draft clinical notes for therapist review.
          </p>
        </div>

        <div className="mt-12 grid items-start gap-10 lg:grid-cols-2">
          <div className={`rasq-reveal ${revealed ? "is-revealed" : ""}`} style={{ transitionDelay: "80ms" }}>
            <p className="mb-5 text-xs font-medium uppercase tracking-[0.1em] text-white/30">
              Illustrative session journey
            </p>
            <div className="relative space-y-0">
              <div className="absolute left-[11px] top-3 bottom-3 w-px bg-[var(--rasq-border)]" />
              {PROGRESS_TIMELINE.map((item) => (
                <div key={item.step} className="relative flex gap-5 pb-6 last:pb-0">
                  <div
                    className={`relative z-10 mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border bg-[var(--rasq-card)] ${
                      item.pending ? "border-[var(--rasq-border)]" : "border-[var(--rasq-teal)]/40"
                    }`}
                  >
                    {item.pending ? (
                      <span className="h-2 w-2 rounded-full border border-[var(--rasq-border)]" />
                    ) : (
                      <span className="h-2 w-2 rounded-full bg-[var(--rasq-teal)]" />
                    )}
                  </div>
                  <div className="flex-1 pt-0.5">
                    <span className="text-sm font-medium text-white">{item.step}</span>
                    <p className="mt-0.5 text-xs text-white/35">{item.detail}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div
            className={`rasq-reveal rounded-[var(--rasq-r-lg)] border border-[var(--rasq-border)] bg-[var(--rasq-base)] ${revealed ? "is-revealed" : ""}`}
            style={{ transitionDelay: "140ms" }}
          >
            <div className="flex items-center justify-between border-b border-[var(--rasq-border)] px-5 py-4">
              <div className="flex items-center gap-2">
                <ArcMark size={14} />
                <span
                  className="text-xs font-medium text-white"
                  style={{ fontFamily: "var(--rasq-font-mono)" }}
                >
                  Clinical review
                </span>
              </div>
              <span className="rounded-[5px] border border-[var(--rasq-teal)]/20 bg-[var(--rasq-teal)]/8 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.08em] text-[var(--rasq-mint)]/70">
                Draft
              </span>
            </div>

            <div className="divide-y divide-[var(--rasq-border)]">
              {REVIEW_ITEMS.map((item) => (
                <div key={item.signal} className="px-5 py-4">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-white/55">{item.signal}</span>
                    <span className="rounded-[5px] bg-[var(--rasq-teal)]/10 px-2 py-0.5 text-[10px] font-medium text-[var(--rasq-mint)]">
                      {item.status}
                    </span>
                  </div>
                  <p className="mt-1 text-[11px] leading-4 text-white/30">{item.note}</p>
                </div>
              ))}
            </div>

            <div className="border-t border-[var(--rasq-border)] px-5 py-3">
              <p className="text-[10px] text-white/25">
                Clinical decision support · Not a diagnosis · Therapist review required
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function AccessSection() {
  const [ref, revealed] = useReveal();

  return (
    <section
      id="providers"
      ref={ref as React.RefObject<HTMLElement>}
      className="bg-[var(--rasq-base)]/82 py-16 lg:py-24"
    >
      <div className="mx-auto max-w-6xl px-6">
        <div className={`rasq-reveal ${revealed ? "is-revealed" : ""}`}>
          <p
            className="text-xs font-medium uppercase tracking-[0.12em] text-[var(--rasq-mint)]/75"
            style={{ fontFamily: "var(--rasq-font-mono)" }}
          >
            Access
          </p>
          <h2
            className="mt-3 max-w-xl text-2xl font-semibold tracking-tight text-white lg:text-[1.75rem]"
            style={{ fontFamily: "var(--rasq-font-display)" }}
          >
            Built for clinical teams and patients.
          </h2>
        </div>

        <div
          className={`rasq-reveal mt-10 grid grid-cols-1 overflow-hidden rounded-[var(--rasq-r-lg)] border border-[var(--rasq-border)] shadow-[0_32px_64px_-48px_rgba(0,0,0,0.8)] lg:grid-cols-2 ${revealed ? "is-revealed" : ""}`}
          style={{ transitionDelay: "80ms" }}
        >
          <div className="flex flex-col p-8 lg:p-10" style={{ background: "var(--rasq-void)" }}>
            <div
              className="rounded-[var(--rasq-r-card)] border border-[var(--rasq-border)] bg-[var(--rasq-card)] p-3.5"
              aria-hidden="true"
            >
              <div className="flex items-center justify-between">
                <span className="text-[9px] font-medium uppercase tracking-[0.1em] text-white/30" style={{ fontFamily: "var(--rasq-font-mono)" }}>
                  Patients
                </span>
                <span className="rounded-[4px] border border-[var(--rasq-teal)]/25 bg-[var(--rasq-teal)]/10 px-1.5 py-0.5 text-[8px] font-medium text-[var(--rasq-mint)]">
                  3 active plans
                </span>
              </div>
              <div className="mt-2.5 space-y-1.5">
                {["Lower limb rehabilitation", "Upper limb recovery"].map((row) => (
                  <div key={row} className="flex items-center justify-between rounded-[5px] border border-[var(--rasq-border)] bg-[var(--rasq-void)] px-2.5 py-1.5">
                    <span className="text-[10px] text-white/50">{row}</span>
                    <span className="h-1.5 w-1.5 rounded-full bg-[var(--rasq-teal)]" />
                  </div>
                ))}
              </div>
            </div>
            <p className="mt-5 text-xs font-medium uppercase tracking-[0.1em] text-white/35">
              For providers
            </p>
            <h3
              className="mt-2 text-xl font-semibold text-white"
              style={{ fontFamily: "var(--rasq-font-display)" }}
            >
              Clinician workspace
            </h3>
            <p className="mt-3 max-w-md text-sm leading-6 text-white/45">
              Manage patients, run assessments, assign plans, and review progress
              from a single clinical workspace.
            </p>
            <div className="mt-7 space-y-2">
              <Link
                href="/login?role=clinician"
                className="group flex items-center justify-between rounded-[var(--rasq-r-btn)] border border-[var(--rasq-teal)]/25 bg-[var(--rasq-teal)]/10 px-4 py-3 transition hover:bg-[var(--rasq-teal)]/14"
              >
                <div>
                  <p className="text-sm font-medium text-white">Clinician sign in</p>
                  <p className="text-xs text-white/40">Patients · Assessments · Plans · Sessions</p>
                </div>
                <ChevronIcon />
              </Link>
              <Link
                href="/login?role=admin"
                className="group flex items-center justify-between rounded-[var(--rasq-r-btn)] border border-[var(--rasq-border)] bg-[var(--rasq-card)] px-4 py-3 transition hover:border-[var(--rasq-teal)]/20"
              >
                <div>
                  <p className="text-sm font-medium text-white/80">Admin workspace</p>
                  <p className="text-xs text-white/30">Clinicians · Assignments · Overview</p>
                </div>
                <ChevronIcon muted />
              </Link>
            </div>
          </div>

          <div
            id="patients"
            className="flex flex-col border-t border-[var(--rasq-border)] p-8 lg:border-l lg:border-t-0 lg:p-10"
            style={{ background: "var(--rasq-warm)" }}
          >
            <div
              className="rounded-[var(--rasq-r-card)] border border-[var(--rasq-warm-bd)] bg-white p-3.5"
              aria-hidden="true"
            >
              <div className="flex items-center justify-between">
                <span className="text-[9px] font-medium uppercase tracking-[0.1em] text-[var(--rasq-warm-tx2)]" style={{ fontFamily: "var(--rasq-font-mono)" }}>
                  Today
                </span>
                <span className="rounded-[4px] border border-[var(--rasq-teal)]/25 bg-[var(--rasq-teal)]/10 px-1.5 py-0.5 text-[8px] font-medium text-[var(--rasq-teal)]">
                  1 session
                </span>
              </div>
              <div className="mt-2.5 rounded-[5px] border border-[var(--rasq-warm-bd)] bg-[var(--rasq-warm)] px-2.5 py-2">
                <p className="text-[10px] font-medium text-[var(--rasq-warm-tx)]">Guided session 9</p>
                <p className="mt-0.5 text-[9px] text-[var(--rasq-warm-tx2)]">10–15 min · Assigned by your therapist</p>
              </div>
            </div>
            <p className="mt-5 text-xs font-medium uppercase tracking-[0.1em] text-[var(--rasq-warm-tx2)]">
              For patients
            </p>
            <h3
              className="mt-2 text-xl font-semibold text-[var(--rasq-warm-tx)]"
              style={{ fontFamily: "var(--rasq-font-display)" }}
            >
              Patient portal
            </h3>
            <p className="mt-3 max-w-md text-sm leading-6 text-[var(--rasq-warm-tx2)]">
              View your plan, complete guided sessions, and track progress through
              the secure link provided by your clinic.
            </p>
            <div className="mt-7 space-y-2">
              <div
                className="rounded-[var(--rasq-r-btn)] border border-[var(--rasq-warm-bd)] bg-white px-4 py-3"
                role="note"
              >
                <p className="text-sm font-medium text-[var(--rasq-warm-tx)]">
                  Use the link from your therapist
                </p>
                <p className="mt-1 text-xs leading-5 text-[var(--rasq-warm-tx2)]">
                  Patient access is issued by your clinic — not through public sign-up.
                </p>
              </div>
              <Link
                href="/assessment-access"
                className="group flex items-center justify-between rounded-[var(--rasq-r-btn)] border border-[var(--rasq-warm-bd)] bg-white px-4 py-3 text-[var(--rasq-warm-tx)] transition hover:border-[var(--rasq-teal)]/35"
              >
                <div>
                  <p className="text-sm font-medium">I have an assessment link</p>
                  <p className="text-xs text-[var(--rasq-warm-tx2)]">
                    Enter your token to begin a remote assessment
                  </p>
                </div>
                <svg className="h-4 w-4 text-[var(--rasq-warm-tx)] opacity-25 transition group-hover:opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                </svg>
              </Link>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

const CAPABILITY_CARDS = [
  {
    id: "assessment",
    name: "Remote assessment",
    tagline: "Secure, clinic-issued access",
    desc:
      "Patients complete structured remote assessments through a secure clinic link — no public sign-up, no separate login.",
    specs: ["Secure clinic links", "No public sign-up", "Clinician-reviewed submissions"],
  },
  {
    id: "reporting",
    name: "Structured reporting",
    tagline: "Export-ready documentation",
    desc:
      "Session and progress data compiled into clinician-reviewed reports, structured for referral and records.",
    specs: ["Clinician-reviewed", "Referral-ready", "Structured for records"],
  },
];

function CapabilitiesSection() {
  const [ref, revealed] = useReveal(0.15);

  return (
    <section
      ref={ref as React.RefObject<HTMLElement>}
      className="bg-transparent py-16 lg:py-24"
    >
      <div className="mx-auto max-w-6xl px-6">
        <div className={`rasq-reveal ${revealed ? "is-revealed" : ""}`}>
          <p
            className="text-xs font-medium uppercase tracking-[0.12em] text-[var(--rasq-mint)]/75"
            style={{ fontFamily: "var(--rasq-font-mono)" }}
          >
            Capabilities
          </p>
          <h2
            className="mt-3 max-w-2xl text-2xl font-semibold tracking-tight text-white lg:text-[1.75rem]"
            style={{ fontFamily: "var(--rasq-font-display)" }}
          >
            Built for how care actually happens.
          </h2>
        </div>

        <div
          className={`mt-10 grid grid-cols-1 gap-5 sm:grid-cols-2 rasq-reveal-children ${revealed ? "is-revealed" : ""}`}
        >
          {CAPABILITY_CARDS.map((card) => (
            <div
              key={card.id}
              className="relative flex flex-col rounded-[var(--rasq-r-card)] border border-[var(--rasq-border)] bg-[var(--rasq-card)] p-6"
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-[8px] border border-[var(--rasq-border)] bg-[var(--rasq-base)] text-[var(--rasq-mint)]">
                {card.id === "assessment" ? (
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9.348 14.651a3.75 3.75 0 010-5.303m5.304-.002a3.75 3.75 0 010 5.304m-7.425 2.122a6.75 6.75 0 010-9.546m9.546 0a6.75 6.75 0 010 9.546M5.106 18.894c-3.808-3.808-3.808-9.98 0-13.789m13.788 0c3.808 3.808 3.808 9.981 0 13.79M12 12h.008v.007H12V12zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
                  </svg>
                ) : (
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3-15H6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 006 21h12a2.25 2.25 0 002.25-2.25V6.108c0-.464-.184-.909-.513-1.237l-3.109-3.109A1.5 1.5 0 0015.516 1.5H15.75z" />
                  </svg>
                )}
              </div>

              <p
                className="mt-5 text-xs font-medium uppercase tracking-[0.1em] text-[var(--rasq-mint)]/60"
                style={{ fontFamily: "var(--rasq-font-mono)" }}
              >
                {card.tagline}
              </p>
              <h3
                className="mt-1 text-lg font-semibold text-white"
                style={{ fontFamily: "var(--rasq-font-display)" }}
              >
                {card.name}
              </h3>
              <p className="mt-3 text-sm leading-6 text-white/40">{card.desc}</p>

              <ul className="mt-5 space-y-1.5">
                {card.specs.map((spec) => (
                  <li key={spec} className="flex items-center gap-2 text-xs text-white/30">
                    <span className="h-1 w-1 rounded-full bg-[var(--rasq-teal)]/50" />
                    {spec}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="relative z-10 border-t border-[var(--rasq-border)] bg-transparent">
      <div className="mx-auto max-w-6xl px-6 py-12">
        <div className="grid grid-cols-1 gap-10 sm:grid-cols-[1.2fr_auto_auto]">
          <div>
            <div className="flex items-center gap-2.5">
              <ArcMark size={18} />
              <span
                className="text-[15px] font-semibold tracking-[-0.02em] text-white"
                style={{ fontFamily: "var(--rasq-font-display)" }}
              >
                RASQ
              </span>
            </div>
            <p className="mt-3 max-w-sm text-sm leading-6 text-white/40">
              Rehabilitation, precisely. Supports therapist review — not a substitute
              for clinical judgment.
            </p>
            <p className="mt-5 text-xs text-white/25">RASQ by Creative Motion Lab</p>
          </div>

          <div>
            <p className="text-xs font-medium uppercase tracking-[0.1em] text-white/30">
              Access
            </p>
            <ul className="mt-3 space-y-2.5">
              {[
                ["Clinician sign in", "/login?role=clinician"],
                ["Patient assessment link", "/assessment-access"],
                ["Admin sign in", "/login?role=admin"],
              ].map(([label, href]) => (
                <li key={href}>
                  <Link href={href} className="text-sm text-white/45 transition hover:text-white">
                    {label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <p className="text-xs font-medium uppercase tracking-[0.1em] text-white/30">
              Governance
            </p>
            <ul className="mt-3 space-y-2.5">
              {[
                ["Clinical safety", "/clinical-safety"],
                ["Intended use", "/intended-use"],
                ["Privacy", "/privacy"],
                ["Terms", "/terms"],
              ].map(([label, href]) => (
                <li key={href}>
                  <Link href={href} className="text-sm text-white/45 transition hover:text-white">
                    {label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="mt-10 border-t border-[var(--rasq-border)] pt-6">
          <p className="text-xs text-white/25">
            © 2026 Creative Motion Lab. All rights reserved.
          </p>
        </div>
      </div>
    </footer>
  );
}

export default function HomePage() {
  return (
    <div
      className="relative min-h-screen bg-[var(--rasq-void)] text-white"
      style={{ fontFamily: "var(--rasq-font-body)" }}
    >
      <PageAmbientLines />
      <Navbar />
      <main className="relative z-10">
        <HeroSection />
        <TrustBar />
        <WorkflowSection />
        <GuidedRehabilitationSection />
        <ProgressJourneySection />
        <AccessSection />
        <CapabilitiesSection />
      </main>
      <Footer />
    </div>
  );
}