/**

 * One-time dev asset generation for PNF D1 endpoint SFX.

 * Run: npx tsx scripts/generate-rasq-demo-pnf-endpoint.ts

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



async function generatePnfEndpoint(apiKey: string): Promise<Buffer> {

  const response = await fetch("https://api.elevenlabs.io/v1/sound-generation", {

    method: "POST",

    headers: {

      "xi-api-key": apiKey,

      "Content-Type": "application/json",

      Accept: "audio/mpeg",

    },

    body: JSON.stringify({

      text:

        "One very soft gentle completion chime, quiet warm bell fade, subtle satisfying finish, low volume, 0.5 seconds, no voice, no explosion, no crack, no alarm, no harsh metallic clang",

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

  const outPath = path.join(process.cwd(), "public", "audio", "demo", "pnf-endpoint-en.mp3");

  fs.mkdirSync(path.dirname(outPath), { recursive: true });

  const audio = await generatePnfEndpoint(apiKey);

  fs.writeFileSync(outPath, audio);

  console.log(`Wrote ${outPath} (${audio.length} bytes)`);

}



void main().catch((error) => {

  console.error(error instanceof Error ? error.message : "PNF endpoint generation failed.");

  process.exit(1);

});


