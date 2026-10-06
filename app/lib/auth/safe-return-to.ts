/**
 * Validates post-login redirect targets — same-origin relative paths only.
 */

const UNSAFE_SCHEME = /^(https?:|javascript:|data:|vbscript:)/i;
const PROTOCOL_RELATIVE = /^\/\//;
const BACKSLASH_PATH = /^\/\\/;
const CONTROL_CHARS = /[\u0000-\u001F\u007F]/;

export function resolveSafeReturnTo(
  raw: string | null | undefined,
  fallback: string,
): string {
  const fallbackSafe = normalizeFallback(fallback);
  if (raw == null) return fallbackSafe;

  const value = raw.trim();
  if (!value) return fallbackSafe;

  if (
    UNSAFE_SCHEME.test(value) ||
    PROTOCOL_RELATIVE.test(value) ||
    BACKSLASH_PATH.test(value) ||
    CONTROL_CHARS.test(value)
  ) {
    return fallbackSafe;
  }

  if (!value.startsWith("/")) {
    return fallbackSafe;
  }

  if (value.startsWith("//")) {
    return fallbackSafe;
  }

  // Reject encoded tricks that decode to external URLs at consumption time.
  if (/%2f%2f/i.test(value) || /%5c/i.test(value)) {
    return fallbackSafe;
  }

  return value;
}

function normalizeFallback(fallback: string): string {
  const trimmed = fallback.trim();
  if (trimmed.startsWith("/") && !trimmed.startsWith("//")) {
    return trimmed;
  }
  return "/clinician";
}
