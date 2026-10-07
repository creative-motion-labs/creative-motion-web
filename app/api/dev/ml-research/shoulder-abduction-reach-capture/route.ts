/**
 * POST /api/dev/ml-research/shoulder-abduction-reach-capture
 *
 * DEV-ONLY. RASQ ML bridge, Slice 1 (2026-08-19).
 *
 * Accepts one completed Shoulder Abduction Reach repetition record from a
 * local dev capture session and appends it to a local JSONL file under
 * `dev-data/rasq-ml/shoulder-abduction/` (gitignored). This is a bridge
 * from "the browser has the captured data" to "a local file has it" for
 * manual local testing only — it is not a production endpoint:
 *
 *  - Refuses to run at all outside development (`NODE_ENV === "development"`).
 *  - No Supabase client, no database import, no `cv_session_metrics` write.
 *  - No auth/session/patient-token handling — it is not reachable from, or
 *    intended to be reachable from, the patient/clinician portals.
 *  - Rejects any payload carrying a raw-video/image-shaped key, as a
 *    defense-in-depth check independent of (and additional to) the
 *    schema-level guarantee that `ShoulderAbductionReachRepCaptureRecord`
 *    never includes one.
 */
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { appendShoulderAbductionReachRepRecordLocally } from "@/app/lib/ml-research/shoulder-abduction-reach/local-jsonl-writer";
import type { ShoulderAbductionReachRepCaptureRecord } from "@/app/lib/ml-research/shoulder-abduction-reach/capture-schema";

const FORBIDDEN_PAYLOAD_KEY_PATTERN = /video|image|frame_blob|base64|dataurl/i;

function containsForbiddenKey(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some(containsForbiddenKey);
  }
  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).some(
      ([key, nested]) => FORBIDDEN_PAYLOAD_KEY_PATTERN.test(key) || containsForbiddenKey(nested),
    );
  }
  return false;
}

function isValidRecordShape(body: unknown): body is ShoulderAbductionReachRepCaptureRecord {
  if (!body || typeof body !== "object") return false;
  const record = body as Partial<ShoulderAbductionReachRepCaptureRecord>;
  return (
    !!record.context &&
    typeof record.context.devSessionId === "string" &&
    typeof record.context.repetitionId === "string" &&
    Array.isArray(record.frames) &&
    !!record.derivedFeatures
  );
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (process.env.NODE_ENV !== "development") {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  if (!isValidRecordShape(body)) {
    return NextResponse.json({ error: "invalid_record_shape" }, { status: 400 });
  }

  if (containsForbiddenKey(body)) {
    return NextResponse.json({ error: "forbidden_payload_key" }, { status: 400 });
  }

  try {
    const { filePath } = await appendShoulderAbductionReachRepRecordLocally(body);
    return NextResponse.json({ ok: true, filePath });
  } catch {
    return NextResponse.json({ error: "write_failed" }, { status: 500 });
  }
}
