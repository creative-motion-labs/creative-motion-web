import { NextResponse } from "next/server";
import type { User } from "@supabase/supabase-js";
import { requireApprovedProviderSession } from "./require-approved-provider";

export type ClinicianSessionResult =
  | { ok: true; user: User }
  | { ok: false; response: NextResponse };

/**
 * Require a valid Supabase session and approved provider access for server API routes.
 */
export async function requireClinicianSession(): Promise<ClinicianSessionResult> {
  const result = await requireApprovedProviderSession();
  if (!result.ok) return result;
  return { ok: true, user: result.user };
}
