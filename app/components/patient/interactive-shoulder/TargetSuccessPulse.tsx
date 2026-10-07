"use client";

type TargetSuccessPulseProps = {
  message: string;
  arClass?: string;
};

export function TargetSuccessPulse({ message, arClass = "" }: TargetSuccessPulseProps) {
  return (
    <div
      className="pointer-events-none absolute inset-x-0 bottom-14 z-40 flex justify-center px-4 sm:bottom-16"
      role="status"
      aria-live="polite"
    >
      <div
        className={`inline-flex items-center gap-1.5 text-[11px] font-medium text-[#D7F5EA] motion-safe:animate-[target-success-pop_0.24s_ease-out] sm:text-[12px] ${arClass}`}
      >
        <span aria-hidden className="text-[#5DCAA5]">
          ✓
        </span>
        <span>{message}</span>
      </div>
    </div>
  );
}
