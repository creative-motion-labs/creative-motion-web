import type { NextRequest } from "next/server";
import {
  readBoundedVolunteerJsonBody,
  volunteerJsonResponse,
} from "./volunteer-api-guards";
import { VOLUNTEER_REPETITION_MAX_JSON_BYTES } from "./volunteer-repetition-validation";

export type ReadVolunteerRepetitionBodyResult =
  | { ok: true; body: Record<string, unknown> }
  | { ok: false; response: ReturnType<typeof volunteerJsonResponse> };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Read and parse a volunteer repetition JSON body using the shared bounded reader.
 * Preserves the repetition-specific 1 MiB ceiling and rejects non-object payloads.
 */
export async function readVolunteerRepetitionJsonBody(
  req: NextRequest,
  maxBytes: number = VOLUNTEER_REPETITION_MAX_JSON_BYTES,
): Promise<ReadVolunteerRepetitionBodyResult> {
  const parsed = await readBoundedVolunteerJsonBody(req, maxBytes);
  if (!parsed.ok) {
    if (parsed.response.status === 413) {
      return {
        ok: false,
        response: volunteerJsonResponse(
          { error: "Repetition payload exceeds allowed size." },
          413,
        ),
      };
    }
    return { ok: false, response: parsed.response };
  }

  const value = parsed.value;
  if (!isPlainObject(value) || Object.keys(value).length === 0) {
    return {
      ok: false,
      response: volunteerJsonResponse({ error: "Invalid JSON body." }, 400),
    };
  }

  return { ok: true, body: value };
}
