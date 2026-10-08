"use client";

import { useLayoutEffect } from "react";
import { resolveUpdatePasswordRecoveryRedirect } from "@/app/lib/auth/recovery-hash-redirect";

/**
 * On `/`, forwards Supabase implicit recovery hashes to `/update-password` unchanged.
 * Tokens stay in the fragment (never sent to the server).
 */
export function RootRecoveryHashRedirect() {
  useLayoutEffect(() => {
    const target = resolveUpdatePasswordRecoveryRedirect(window.location.hash);
    if (target) {
      window.location.replace(target);
    }
  }, []);

  return null;
}
