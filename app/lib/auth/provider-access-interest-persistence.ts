import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { ProviderAccessInterestPayload } from "./provider-access-interest-validation";

export type ProviderAccessInterestRecord = ProviderAccessInterestPayload & {
  id: string;
  submittedAt: string;
  source: "public-signup";
};

function interestDirectory(): string {
  return join(process.cwd(), "dev-data", "provider-access");
}

function interestFilePath(): string {
  return join(interestDirectory(), "provider-access-interest.jsonl");
}

/** Local fallback when Supabase admin client is unavailable (development only). */
export async function appendProviderAccessInterestRecordLocal(
  payload: ProviderAccessInterestPayload,
): Promise<ProviderAccessInterestRecord> {
  const record: ProviderAccessInterestRecord = {
    ...payload,
    id: crypto.randomUUID(),
    submittedAt: new Date().toISOString(),
    source: "public-signup",
  };
  const dir = interestDirectory();
  await mkdir(dir, { recursive: true });
  await appendFile(interestFilePath(), `${JSON.stringify(record)}\n`, "utf8");
  return record;
}
