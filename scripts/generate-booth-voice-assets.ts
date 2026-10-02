/**

 * One-time licensed asset generation (dev machine only). Not used at session runtime.

 * Run: npx tsx scripts/generate-booth-voice-assets.ts [cue-id ...]
 * Run: npx tsx scripts/generate-booth-voice-assets.ts --remote-battery-only

 */

import fs from "node:fs";

import path from "node:path";

import {

  BOOTH_VOICE_TTS_OUTPUT_FORMAT,

  BOOTH_VOICE_TTS_VOICE_SETTINGS,

  INTERACTIVE_SHOULDER_BOOTH_VOICE_ID,

  resolveBoothVoiceCueLanguage,

  resolveBoothVoiceTtsModel,

} from "../app/lib/booth/booth-voice-tts-profile";

import {
  BOOTH_VOICE_CUE_MANIFEST,
  REMOTE_BATTERY_BOOTH_VOICE_CUE_IDS,
  type BoothVoiceCue,
} from "../app/lib/booth/booth-voice-manifest";



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



async function synthesizeMp3(

  text: string,

  apiKey: string,

  voiceId: string,

  cueId: string,

): Promise<Buffer> {

  const lang = resolveBoothVoiceCueLanguage(cueId);

  const modelId = resolveBoothVoiceTtsModel(lang);

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

      model_id: modelId,

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

    console.error("ELEVENLABS_API_KEY is not set. Cannot generate booth voice assets.");

    process.exit(1);

  }

  const voiceId = env.ELEVENLABS_BOOTH_VOICE_ID?.trim() || INTERACTIVE_SHOULDER_BOOTH_VOICE_ID;

  const outDir = path.join(process.cwd(), "public", "audio", "booth");

  fs.mkdirSync(outDir, { recursive: true });



  const argv = process.argv.slice(2);
  const batteryOnly = argv.includes("--remote-battery-only");
  const requested = (batteryOnly ? [] : argv.filter((arg) => arg !== "--remote-battery-only")) as BoothVoiceCue[];

  const allCues = Object.keys(BOOTH_VOICE_CUE_MANIFEST) as BoothVoiceCue[];

  const cues = batteryOnly
    ? [...REMOTE_BATTERY_BOOTH_VOICE_CUE_IDS]
    : requested.length > 0
      ? requested.filter((cue): cue is BoothVoiceCue => allCues.includes(cue))
      : allCues;

  if (batteryOnly) {
    const invalid = cues.filter((cue) => !cue.startsWith("battery-"));
    if (invalid.length > 0) {
      console.error("Remote battery-only mode refused non-battery cue ids:", invalid.join(", "));
      process.exit(1);
    }
  }

  if (!batteryOnly && requested.length > 0 && cues.length === 0) {
    console.error("No valid booth voice cue ids in argv. Valid:", allCues.join(", "));
    process.exit(1);
  }



  for (const cue of cues) {

    const { file, script } = BOOTH_VOICE_CUE_MANIFEST[cue];

    const audio = await synthesizeMp3(script, apiKey, voiceId, cue);

    fs.writeFileSync(path.join(outDir, file), audio);

    console.log(`Wrote public/audio/booth/${file}`);

  }

}



void main().catch((error) => {

  console.error(error instanceof Error ? error.message : "Booth voice generation failed.");

  process.exit(1);

});


