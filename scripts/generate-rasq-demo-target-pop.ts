/**
 * One-time dev asset generation for demo target-hit SFX.
 * Run: npx tsx scripts/generate-rasq-demo-target-pop.ts
 */

import fs from "node:fs";
import path from "node:path";

function loadEnvLocal(): Record<string, string> {
  const envPath = path.join(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) return {};
  const env: Record<string, string> = {};
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

async function generateTargetPop(apiKey: string): Promise<Buffer> {
  const response = await fetch("https://api.elevenlabs.io/v1/sound-generation", {
    method: "POST",
    headers: {
      "xi-api-key": apiKey,
      "Content-Type": "application/json",
      Accept: "audio/mpeg",
    },
    body: JSON.stringify({
      text:
        "Very subtle soft bright chime sparkle, gentle UI confirmation tick, short delicate bell shimmer, quiet and pleasant, 0.4 seconds, no voice, no explosion, no balloon pop, no crack, no alarm, no harsh coin",
      duration_seconds: 0.5,
      prompt_influence: 0.7,
    }),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`ElevenLabs sound generation failed (${response.status}): ${detail.slice(0, 200)}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

async function main(): Promise<void> {
  const env = { ...loadEnvLocal(), ...process.env };
  const apiKey = env.ELEVENLABS_API_KEY?.trim();
  if (!apiKey) {
    console.error("ELEVENLABS_API_KEY is not set.");
    process.exit(1);
  }
  const outPath = path.join(process.cwd(), "public", "audio", "demo", "target-pop-en.mp3");
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const audio = await generateTargetPop(apiKey);
  fs.writeFileSync(outPath, audio);
  console.log(`Wrote ${outPath} (${audio.length} bytes)`);
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Target pop generation failed.");
  process.exit(1);
});
