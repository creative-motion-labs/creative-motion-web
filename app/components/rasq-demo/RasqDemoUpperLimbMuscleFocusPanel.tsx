"use client";

import Image from "next/image";

export const RASQ_DEMO_UPPER_LIMB_MUSCLES_IMAGE_PATH =
  "/images/rasq-demo/upper-limb-muscles-front.png";

const MUSCLE_FOCUS_ALT =
  "Front-view upper-limb muscle anatomy with the right arm highlighted.";

/** Demo-only muscle reference beside the live preview for the full movement demo. */
export function RasqDemoUpperLimbMuscleFocusPanel() {
  return (
    <figure className="sticky top-4 rounded-[10px] border border-[#C7E8DC] bg-gradient-to-b from-[#F0FDF9] to-[#F1F5F9] p-3 shadow-sm">
      <div className="overflow-hidden rounded-[8px] border border-[#CBD5E1] bg-[#0F172A]">
        <Image
          src={RASQ_DEMO_UPPER_LIMB_MUSCLES_IMAGE_PATH}
          alt={MUSCLE_FOCUS_ALT}
          width={400}
          height={600}
          className="h-auto w-full object-contain"
          priority={false}
        />
      </div>
      <figcaption className="mt-3 space-y-1">
        <p className="text-xs font-semibold text-[#0F172A]">Upper-limb muscle focus</p>
        <p className="text-[11px] text-[#64748B]">Deltoid • Biceps • Triceps • Forearm</p>
        <p className="text-[10px] leading-snug text-[#94A3B8]">
          Illustration for orientation — not a diagnosis.
        </p>
      </figcaption>
    </figure>
  );
}
