import type { ErrorEvent } from "@sentry/nextjs";

const AI_ROUTE_BODY_REDACT =
  /\/api\/(?:assessments\/[^/?#]+\/translate|voice(?:\/|$))/;

const VOLUNTEER_RESEARCH_ROUTE_BODY_REDACT =
  /^\/api\/research\/volunteer\/(?:sessions|movement-sessions|session\/complete|repetitions)$/;

const REDACTED_BODY = "[AI request body redacted]";
const REDACTED_VOLUNTEER_BODY = "[Volunteer research request body redacted]";

function redactSensitiveUrls(url: string): string {
  return url
    .replace(/\/patient\/[^/?#]+/g, "/patient/[token-redacted]")
    .replace(/\/assessment\/[^/?#]+/g, "/assessment/[token-redacted]");
}

function volunteerRoutePathname(url: string): string | null {
  try {
    return new URL(url, "http://localhost").pathname;
  } catch {
    return null;
  }
}

function redactAiRequestBody(event: ErrorEvent): void {
  const url = event.request?.url ?? "";
  if (!AI_ROUTE_BODY_REDACT.test(url)) return;

  if (event.request?.data !== undefined) {
    event.request.data = REDACTED_BODY;
  }

  if (event.request?.headers) {
    delete event.request.headers["x-openai-key"];
    delete event.request.headers["authorization"];
  }
}

function redactVolunteerResearchRequest(event: ErrorEvent): void {
  const url = event.request?.url ?? "";
  const pathname = volunteerRoutePathname(url);
  if (!pathname || !VOLUNTEER_RESEARCH_ROUTE_BODY_REDACT.test(pathname)) return;

  if (event.request?.data !== undefined) {
    event.request.data = REDACTED_VOLUNTEER_BODY;
  }

  if (event.request?.headers) {
    delete event.request.headers["x-volunteer-session-token"];
    delete event.request.headers["x-volunteer-campaign-code"];
    delete event.request.headers["x-volunteer-deletion-code"];
  }
}

/** Shared Sentry privacy filter — preserves existing redaction and adds AI route body redaction. */
export function applySentryPrivacy(event: ErrorEvent): ErrorEvent | null {
  if (event.request?.url) {
    event.request.url = redactSensitiveUrls(event.request.url);
  }

  if (event.request?.headers) {
    delete event.request.headers["cookie"];
    delete event.request.headers["authorization"];
  }

  redactAiRequestBody(event);
  redactVolunteerResearchRequest(event);
  delete event.user;

  return event;
}
