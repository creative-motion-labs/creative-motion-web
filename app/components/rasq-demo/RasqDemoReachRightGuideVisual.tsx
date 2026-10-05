"use client";

import Image from "next/image";
import { RASQ_DEMO_REACH_TO_RIGHT_ILLUSTRATION } from "@/app/lib/rasq-demo/demo-exercise-illustrations";

type RasqDemoReachRightGuideVisualProps = {
  reducedMotion?: boolean;
};

export function RasqDemoReachRightGuideVisual({
  reducedMotion: _reducedMotion = false,
}: RasqDemoReachRightGuideVisualProps) {
  const { src, alt, width, height } = RASQ_DEMO_REACH_TO_RIGHT_ILLUSTRATION;

  return (
    <figure className="rounded-[10px] border border-[#C7E8DC] bg-gradient-to-br from-[#F0FDF9] to-[#ECFEFF] p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-[#1D9E75]">Reach to Right</p>
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
      <figcaption className="mt-2 text-sm text-[#475569]">
        Lift your arm out to the side and reach toward each target on your right.
      </figcaption>
    </figure>
  );
}
