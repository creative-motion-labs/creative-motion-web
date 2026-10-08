/**
 * Development-only Interactive Shoulder session tracing (no PHI, tokens, or frames).
 */

export type InteractiveShoulderDevTracePayload = Record<string, string | number | boolean | null>;

function isDevTraceEnabled(): boolean {
  return typeof process !== "undefined" && process.env.NODE_ENV === "development";
}

export function traceInteractiveShoulderSessionDev(
  tag: string,
  payload: InteractiveShoulderDevTracePayload,
): void {
  if (!isDevTraceEnabled()) return;
  console.debug(`[interactive-shoulder-dev:${tag}]`, payload);
}
