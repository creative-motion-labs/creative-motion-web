"use client";

import Link from "next/link";

const GAIT_ASSESSMENT_HREF = "/clinician/assessments/gait";
const STS_ASSESSMENT_REVIEW_HREF = "/clinician/assessments/sit-to-stand";
const SINGLE_LEG_STANCE_HREF = "/clinician/assessments/single-leg-stance";
const FUNCTIONAL_REACH_HREF = "/clinician/assessments/functional-reach";
const TIMED_UP_AND_GO_HREF = "/clinician/assessments/timed-up-and-go";
const UPPER_LIMB_MOTOR_SCREEN_HREF = "/clinician/assessments/upper-limb-motor-screen";

type AssessmentCard = {
  title: string;
  status: string;
  statusTone: "coming" | "foundation";
  description: string;
  href?: string;
  cta?: string;
  footnote?: string;
};

const ASSESSMENT_CARDS: AssessmentCard[] = [
  {
    title: "Gait Assessment",
    status: "Assessment shell · v1",
    statusTone: "foundation",
    description: "Camera-assisted walking observation for therapist review.",
    href: GAIT_ASSESSMENT_HREF,
    cta: "Open gait observation",
  },
  {
    title: "Sit-to-Stand Assessment",
    status: "Available foundation · Existing motion evidence",
    statusTone: "foundation",
    description:
      "Repetition, timing, and movement quality observations for therapist review.",
    href: STS_ASSESSMENT_REVIEW_HREF,
    cta: "Review Sit-to-Stand results",
    footnote: "Existing motion evidence from patient sessions may inform therapist review.",
  },
  {
    title: "Single Leg Stance Assessment",
    status: "Assessment shell · coming next",
    statusTone: "coming",
    description:
      "Single-leg stance functional assessment task for movement observation and therapist review.",
    href: SINGLE_LEG_STANCE_HREF,
    cta: "Open single-leg stance module",
  },
  {
    title: "Functional Reach Assessment",
    status: "Assessment shell · coming next",
    statusTone: "coming",
    description:
      "Forward reach functional assessment task for movement observation and therapist review.",
    href: FUNCTIONAL_REACH_HREF,
    cta: "Open functional reach module",
  },
  {
    title: "Timed Up and Go Assessment",
    status: "Assessment shell · coming next",
    statusTone: "coming",
    description:
      "Timed functional assessment task for movement observation and therapist review.",
    href: TIMED_UP_AND_GO_HREF,
    cta: "Open timed up and go module",
  },
  {
    title: "Upper Limb Motor Screen",
    status: "Pilot · Lateral reach observation",
    statusTone: "foundation",
    description:
      "Camera-assisted lateral reach observation for therapist review and rehabilitation planning.",
    href: UPPER_LIMB_MOTOR_SCREEN_HREF,
    cta: "Open upper limb motor screen",
    footnote:
      "Therapist review required. Observations may support rehabilitation planning — not diagnostic.",
  },
  {
    title: "Patient-Reported Forms",
    status: "Coming next",
    statusTone: "coming",
    description: "Pain, effort, confidence, and symptom tracking.",
  },
];

function statusBadgeClass(tone: AssessmentCard["statusTone"]): string {
  if (tone === "foundation") {
    return "border-[#1D9E75]/30 bg-[#1D9E75]/10 text-[#5DCAA5]";
  }
  return "border-[#1E2D42] bg-[#0B1220] text-white/45";
}

export default function AssessmentCenterPage() {
  return (
    <div className="min-h-screen bg-[#0B1220] px-6 py-8 text-white">
      <div className="mx-auto max-w-5xl">
        <p className="text-[10px] font-bold uppercase tracking-widest text-[#1D9E75]">
          RASQ · Movement assessments
        </p>
        <h1 className="mt-2 text-2xl font-bold text-white">Assessment Center</h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-white/45">
          Plan and review structured movement assessments. Each module will provide
          camera-assisted observations and assistive metrics to support therapist review.
        </p>

        <div className="mt-5 rounded-[10px] border border-amber-400/20 bg-amber-400/5 px-4 py-3.5">
          <p className="text-[11px] font-bold uppercase tracking-wider text-amber-200/90">
            Therapist review required
          </p>
          <p className="mt-2 text-sm leading-relaxed text-white/55">
            Camera-assisted assessments provide movement observations to support therapist
            review. They are not diagnostic and do not replace clinical examination.
          </p>
        </div>

        <section className="mt-6">
          <h2 className="text-sm font-bold text-white">Assessment modules</h2>
          <p className="mt-1 text-xs text-white/35">
            Movement evidence modules for pilot rollout. Full capture workflows arrive in
            upcoming releases.
          </p>

          <ul className="mt-4 grid gap-4 sm:grid-cols-2">
            {ASSESSMENT_CARDS.map((card) => {
              const cardBody = (
                <>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <h3 className="text-[15px] font-semibold text-white">{card.title}</h3>
                    <span
                      className={`shrink-0 rounded-[5px] border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${statusBadgeClass(card.statusTone)}`}
                    >
                      {card.status}
                    </span>
                  </div>
                  <p className="mt-3 text-sm leading-relaxed text-white/45">{card.description}</p>
                  {card.footnote ? (
                    <p className="mt-3 text-[11px] text-white/30">{card.footnote}</p>
                  ) : null}
                  {card.cta ? (
                    <p className="mt-4 inline-flex items-center gap-1.5 text-xs font-semibold text-[#5DCAA5]">
                      {card.cta}
                      <span aria-hidden className="transition group-hover:translate-x-0.5">
                        →
                      </span>
                    </p>
                  ) : null}
                </>
              );

              if (card.href) {
                return (
                  <li key={card.title}>
                    <Link
                      href={card.href}
                      className="group block rounded-[10px] border border-[#1E2D42] bg-[#0F1825] p-5 transition hover:border-[#1D9E75]/30 hover:bg-[#0d1f18]"
                    >
                      {cardBody}
                    </Link>
                  </li>
                );
              }

              return (
                <li
                  key={card.title}
                  className="rounded-[10px] border border-[#1E2D42] bg-[#0F1825] p-5"
                >
                  {cardBody}
                </li>
              );
            })}
          </ul>
        </section>

        <p className="mt-8 text-[11px] leading-relaxed text-white/25">
          Remote questionnaire and in-clinic documentation remain available from the dashboard
          and patient profile. This center will expand with camera-assisted assessment workflows.
        </p>
      </div>
    </div>
  );
}
