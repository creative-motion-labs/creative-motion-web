"use client";

import Image from "next/image";
import { RASQ_DEMO_PNF_WELCOME_ANNOTATION } from "@/app/lib/rasq-demo/demo-consent-copy";
import { RASQ_DEMO_PNF_D1_ILLUSTRATION } from "@/app/lib/rasq-demo/demo-exercise-illustrations";

type RasqDemoPnfD1GuideVisualProps = {
  reducedMotion?: boolean;
};

export function RasqDemoPnfD1GuideVisual({
  reducedMotion: _reducedMotion = false,
}: RasqDemoPnfD1GuideVisualProps) {
  const { src, alt, width, height } = RASQ_DEMO_PNF_D1_ILLUSTRATION;

  return (
    <figure className="rounded-[10px] border border-[#C7E8DC] bg-gradient-to-br from-[#F0FDF9] to-[#ECFEFF] p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-[#1D9E75]">
        PNF Diagonal 1 (demonstration)
      </p>
      <div className="relative mt-2 aspect-[4/3] w-full max-w-md overflow-hidden rounded-[8px] bg-white">
        <Image
          src={src}
          alt={alt}
          width={width}
          height={height}
          className="h-full w-full object-contain"
          sizes="(max-width: 640px) 100vw, 28rem"
          priority
        />
      </div>
      <figcaption className="mt-2 space-y-1 text-sm text-[#475569]">
        <p>Trace the diagonal with your right arm at a calm, steady pace.</p>
        <p className="text-xs text-[#64748B]">{RASQ_DEMO_PNF_WELCOME_ANNOTATION}</p>
      </figcaption>
    </figure>
  );
}
