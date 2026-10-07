import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { RasqDemoLeadPayload } from "./demo-leads-validation";
import type { RasqDemoLeadRecord } from "./demo-leads-supabase-store";

function demoLeadsDirectory(): string {
  return join(process.cwd(), "dev-data", "rasq-demo");
}

function demoLeadsFilePath(): string {
  return join(demoLeadsDirectory(), "demo-leads.jsonl");
}

/** Local fallback when Supabase admin client is unavailable (development only). */
export async function appendRasqDemoLeadRecordLocal(
  payload: RasqDemoLeadPayload,
): Promise<RasqDemoLeadRecord> {
  const record: RasqDemoLeadRecord = {
    ...payload,
    id: crypto.randomUUID(),
    submittedAt: new Date().toISOString(),
    source: "rasq-public-demo",
    confirmationEmailSentAt: null,
    confirmationEmailLastError: null,
  };
  const dir = demoLeadsDirectory();
  await mkdir(dir, { recursive: true });
  await appendFile(demoLeadsFilePath(), `${JSON.stringify(record)}\n`, "utf8");
  return record;
}
