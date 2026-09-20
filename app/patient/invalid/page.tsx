export default function InvalidTokenPage() {
  return (
    <div className="font-ui-en flex min-h-screen flex-col items-center justify-center bg-[#080E14] px-6 py-16">
      {/* RASQ arc mark */}
      <svg width="56" height="56" viewBox="0 0 20 20" fill="none" aria-hidden="true">
        <path d="M10 2C5.582 2 2 5.582 2 10s3.582 8 8 8" stroke="#1D9E75" strokeWidth="2.2" strokeLinecap="round" />
        <path d="M10 5.5C7.515 5.5 5.5 7.515 5.5 10S7.515 14.5 10 14.5" stroke="#5DCAA5" strokeWidth="1.8" strokeLinecap="round" />
        <circle cx="10" cy="10" r="1.5" fill="#1D9E75" />
      </svg>

      <p className="rasq-wordmark mt-4 text-[15px] text-white">RASQ</p>

      <p className="mt-1 text-[9px] uppercase tracking-[0.12em] text-[#374151]">
        Rehabilitation, precisely.
      </p>

      <div className="my-6 h-px w-[120px] bg-[#1E2D42]" />

      <p className="text-[14px] text-[#6B7280]">
        This link has expired or is invalid.
      </p>
      <p className="mt-2 text-[12px] text-[#374151]">
        Contact your rehabilitation provider for a new access link.
      </p>
    </div>
  );
}
