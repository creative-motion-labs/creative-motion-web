/**
 * One-time licensed asset generation (dev machine only). Not used at session runtime.
 * Run: npx tsx scripts/generate-rasq-demo-voice-assets.ts
 */

import fs from "node:fs";
import path from "node:path";
import {
  BOOTH_VOICE_TTS_OUTPUT_FORMAT,
  BOOTH_VOICE_TTS_VOICE_SETTINGS,
  BOOTH_VOICE_TTS_MODEL_EN,
  INTERACTIVE_SHOULDER_BOOTH_VOICE_ID,
} from "../app/lib/booth/booth-voice-tts-profile";
import {
  RASQ_DEMO_VOICE_CUE_IDS,
  RASQ_DEMO_VOICE_CUE_MANIFEST,
  type RasqDemoVoiceCue,
} from "../app/lib/rasq-demo/demo-voice-manifest";

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

async function synthesizeMp3(text: string, apiKey: string, voiceId: string): Promise<Buffer> {
  const url = new URL(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`);
  url.searchParams.set("output_format", BOOTH_VOICE_TTS_OUTPUT_FORMAT);
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "xi-api-key": apiKey,
      "Content-Type": "application/json",
      Accept: "audio/mpeg",
    },
    body: JSON.stringify({
      text,
      model_id: BOOTH_VOICE_TTS_MODEL_EN,
      voice_settings: { ...BOOTH_VOICE_TTS_VOICE_SETTINGS },
    }),
  });
  if (!response.ok) {
    throw new Error(`ElevenLabs TTS failed with status ${response.status}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

async function main(): Promise<void> {
  const env = { ...loadEnvLocal(), ...process.env };
  const apiKey = env.ELEVENLABS_API_KEY?.trim();
  if (!apiKey) {
    console.error("ELEVENLABS_API_KEY is not set. Cannot generate demo voice assets.");
    process.exit(1);
  }
  const voiceId = env.ELEVENLABS_BOOTH_VOICE_ID?.trim() || INTERACTIVE_SHOULDER_BOOTH_VOICE_ID;
  const outDir = path.join(process.cwd(), "public", "audio", "demo");
  fs.mkdirSync(outDir, { recursive: true });

  for (const cue of RASQ_DEMO_VOICE_CUE_IDS as readonly RasqDemoVoiceCue[]) {
    const { file, script } = RASQ_DEMO_VOICE_CUE_MANIFEST[cue];
    const audio = await synthesizeMp3(script, apiKey, voiceId);
    fs.writeFileSync(path.join(outDir, file), audio);
    console.log(`Wrote public/audio/demo/${file}`);
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Demo voice generation failed.");
  process.exit(1);
});
