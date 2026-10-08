/**
 * Client-only Supabase recovery hash handling (implicit grant).
 * Hash fragments never reach the server — home must forward recovery payloads.
 */

export const UPDATE_PASSWORD_RECOVERY_PATH = "/update-password";

/** True when the location hash is a Supabase password-recovery implicit callback. */
export function isSupabaseRecoveryHash(hash: string): boolean {
  if (!hash || hash === "#") return false;
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  if (!raw) return false;
  try {
    const params = new URLSearchParams(raw);
    return params.get("type") === "recovery";
  } catch {
    return false;
  }
}

/**
 * If `hash` is a recovery callback, return `/update-password` plus the exact same hash.
 * Otherwise null (no redirect).
 */
export function resolveUpdatePasswordRecoveryRedirect(hash: string): string | null {
  if (!isSupabaseRecoveryHash(hash)) return null;
  const normalized = hash.startsWith("#") ? hash : `#${hash}`;
  return `${UPDATE_PASSWORD_RECOVERY_PATH}${normalized}`;
}
