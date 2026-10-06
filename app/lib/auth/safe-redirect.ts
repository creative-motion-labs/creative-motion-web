/**
 * Post-authentication redirect validation — internal application paths only.
 *
 * Used for `/login?returnTo=` and the Supabase auth callback `?next=`.
 * Anything that is not a plain same-origin path (absolute or protocol-relative
 * URLs, backslash tricks, script/data schemes, control characters, encoded
 * variants of those, or malformed encodings) falls back to the caller's default.
 */

const MAX_REDIRECT_PATH_LENGTH = 2048;
const MAX_DECODE_PASSES = 3;
const VALIDATION_BASE = "https://rasq-internal.invalid";

// Browsers strip tab/newline and treat "\" as "/", so "/\t/evil" or "/\evil" become "//evil".
const FORBIDDEN_CHARACTERS = /[\u0000-\u001F\u007F\\]/;

function isSafePathShape(value: string): boolean {
  if (value.trim() !== value) return false;
  if (!value.startsWith("/")) return false;
  if (value.startsWith("//")) return false;
  if (FORBIDDEN_CHARACTERS.test(value)) return false;
  return true;
}

/**
 * Returns a normalized internal path (pathname + search + hash) when `raw` is safe,
 * otherwise `fallback`.
 */
export function resolveSafeAuthRedirectPath(
  raw: string | null | undefined,
  fallback: string,
): string {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > MAX_REDIRECT_PATH_LENGTH) {
    return fallback;
  }

  // Reject encoded bypasses: every decoded form must also be a plain internal path.
  let decoded = raw;
  for (let pass = 0; pass <= MAX_DECODE_PASSES; pass += 1) {
    if (!isSafePathShape(decoded)) return fallback;
    let next: string;
    try {
      next = decodeURIComponent(decoded);
    } catch {
      return fallback;
    }
    if (next === decoded) break;
    if (pass === MAX_DECODE_PASSES) return fallback;
    decoded = next;
  }

  let parsed: URL;
  try {
    parsed = new URL(raw, VALIDATION_BASE);
  } catch {
    return fallback;
  }
  if (parsed.origin !== VALIDATION_BASE) return fallback;

  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}
