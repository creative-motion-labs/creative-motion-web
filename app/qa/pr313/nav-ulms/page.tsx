"use client";

import Link from "next/link";

export const PR313_ULMS_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
export const PR313_ULMS_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

export default function Pr313NavUlmsPage() {
  return (
    <>
      <h1 className="text-xl font-bold">Remote ULMS token navigation</h1>
      <div className="mt-4 flex flex-wrap gap-3">
        <Link
          data-testid="nav-ulms-a"
          className="rounded bg-[#1D9E75] px-3 py-2 text-sm font-semibold"
          href={`/patient/assessment/${PR313_ULMS_A}`}
        >
          ULMS A
        </Link>
        <Link
          data-testid="nav-ulms-b"
          className="rounded bg-[#1D9E75] px-3 py-2 text-sm font-semibold"
          href={`/patient/assessment/${PR313_ULMS_B}`}
        >
          ULMS B
        </Link>
      </div>
    </>
  );
}
