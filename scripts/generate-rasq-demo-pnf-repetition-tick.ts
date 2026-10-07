/**
 * Dev asset: subtle PNF repetition endpoint tick.
 * Run: npx tsx scripts/generate-rasq-demo-pnf-repetition-tick.ts
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

async function generateTick(apiKey: string): Promise<Buffer> {
  const response = await fetch("https://api.elevenlabs.io/v1/sound-generation", {
    method: "POST",
    headers: {
      "xi-api-key": apiKey,
      "Content-Type": "application/json",
      Accept: "audio/mpeg",
    },
    body: JSON.stringify({
      text:
        "Very quiet subtle UI tick, soft short background chime blip, gentle sparkle under dialogue, 0.35 seconds, extremely low presence, no voice, no pop, no crack, no alarm",
      duration_seconds: 0.5,
      prompt_influence: 0.72,
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
  const outPath = path.join(process.cwd(), "public", "audio", "demo", "pnf-repetition-tick-en.mp3");
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const audio = await generateTick(apiKey);
  fs.writeFileSync(outPath, audio);
  console.log(`Wrote ${outPath} (${audio.length} bytes)`);
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : "PNF repetition tick generation failed.");
  process.exit(1);
});
