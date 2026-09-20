"use client";

type ShoulderLiveInstructionStripProps = {
  message: string;
  arClass?: string;
  multiline?: boolean;
};

export function ShoulderLiveInstructionStrip({
  message,
  arClass = "",
  multiline = false,
}: ShoulderLiveInstructionStripProps) {
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-30 px-3 pb-3 sm:px-4 sm:pb-4">
      <p
        className={`mx-auto max-w-3xl border-t border-white/10 bg-[#0A0F1A]/55 px-4 py-2.5 text-center text-[12px] font-normal leading-snug text-white/88 backdrop-blur-[2px] sm:text-[13px] lg:text-[14px] ${multiline ? "line-clamp-3 whitespace-pre-line" : "line-clamp-2"} ${arClass}`}
        role="status"
        aria-live="polite"
      >
        {message}
      </p>
    </div>
  );
}
