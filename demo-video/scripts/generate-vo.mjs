// Generate the demo-video voiceover via Gemini TTS.
//
//   node scripts/generate-vo.mjs --samples            # audition: 3 voices on one line → public/audio/samples/
//   node scripts/generate-vo.mjs --voice=Charon       # full run: all scenes → public/audio/s0.wav … s8.wav + manifest.json
//   node scripts/generate-vo.mjs --voice=Charon --only=s3   # regenerate one scene (updates manifest)
//   --model=gemini-2.5-flash-preview-tts              # fallback if pro quota is tight
//
// Reads GEMINI_API_KEY from ../​.env (the sprint0 root) or the environment.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import {
  NARRATION_BASE_STYLE,
  SAMPLE_SCENE_ID,
  SCENES,
  VOICE_CANDIDATES,
} from "./script-data.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const AUDIO_DIR = path.join(ROOT, "public", "audio");
const MANIFEST = path.join(AUDIO_DIR, "manifest.json");

dotenv.config({ path: path.join(ROOT, "..", ".env"), quiet: true });

const API_KEY = process.env.GEMINI_API_KEY;
if (!API_KEY) {
  console.error("GEMINI_API_KEY not found (checked ../.env and env).");
  process.exit(1);
}

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    return m ? [m[1], m[2] ?? true] : [a, true];
  }),
);

const MODEL = args.model || "gemini-2.5-pro-preview-tts";
const SAMPLE_RATE = 24000; // Gemini TTS output: PCM s16le mono 24kHz

// --vertex: route through Vertex AI (billed project quota) instead of the
// free-tier generativelanguage endpoint. Uses ADC via gcloud.
let vertexToken = null;
async function getVertexToken() {
  if (vertexToken) return vertexToken;
  const { execSync } = await import("node:child_process");
  vertexToken = execSync("gcloud auth application-default print-access-token", {
    encoding: "utf8",
  }).trim();
  return vertexToken;
}

const wavHeader = (dataLen) => {
  const h = Buffer.alloc(44);
  h.write("RIFF", 0);
  h.writeUInt32LE(36 + dataLen, 4);
  h.write("WAVE", 8);
  h.write("fmt ", 12);
  h.writeUInt32LE(16, 16); // PCM chunk size
  h.writeUInt16LE(1, 20); // PCM format
  h.writeUInt16LE(1, 22); // mono
  h.writeUInt32LE(SAMPLE_RATE, 24);
  h.writeUInt32LE(SAMPLE_RATE * 2, 28); // byte rate (16-bit mono)
  h.writeUInt16LE(2, 32); // block align
  h.writeUInt16LE(16, 34); // bits per sample
  h.write("data", 36);
  h.writeUInt32LE(dataLen, 40);
  return h;
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function tts(text, voice) {
  let url;
  const headers = { "Content-Type": "application/json" };
  if (args.vertex) {
    const proj = process.env.GOOGLE_CLOUD_PROJECT;
    const loc = process.env.GOOGLE_CLOUD_LOCATION || "us-central1";
    url = `https://${loc}-aiplatform.googleapis.com/v1/projects/${proj}/locations/${loc}/publishers/google/models/${MODEL}:generateContent`;
    headers.Authorization = `Bearer ${await getVertexToken()}`;
  } else {
    url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${API_KEY}`;
  }
  const body = {
    contents: [{ role: "user", parts: [{ text }] }],
    generationConfig: {
      responseModalities: ["AUDIO"],
      speechConfig: {
        voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } },
      },
    },
  };
  for (let attempt = 1; attempt <= 4; attempt++) {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    if (res.status === 429 || res.status >= 500) {
      const wait = attempt * 15000;
      console.log(`  ${res.status} — retry in ${wait / 1000}s (attempt ${attempt}/4)`);
      await sleep(wait);
      continue;
    }
    if (!res.ok) {
      throw new Error(`TTS ${res.status}: ${(await res.text()).slice(0, 500)}`);
    }
    const json = await res.json();
    const b64 = json.candidates?.[0]?.content?.parts?.find((p) => p.inlineData)
      ?.inlineData?.data;
    if (!b64) throw new Error(`No audio in response: ${JSON.stringify(json).slice(0, 500)}`);
    return Buffer.from(b64, "base64");
  }
  throw new Error("TTS failed after 4 attempts (rate limit?)");
}

const promptFor = (scene) =>
  `${NARRATION_BASE_STYLE} ${scene.style}\n\nSay exactly this:\n${scene.vo}`;

async function writeWav(file, pcm) {
  await writeFile(file, Buffer.concat([wavHeader(pcm.length), pcm]));
  return pcm.length / (SAMPLE_RATE * 2); // seconds
}

async function main() {
  await mkdir(AUDIO_DIR, { recursive: true });

  if (args.samples) {
    const scene = SCENES.find((s) => s.id === SAMPLE_SCENE_ID);
    const dir = path.join(AUDIO_DIR, "samples");
    await mkdir(dir, { recursive: true });
    for (const voice of VOICE_CANDIDATES) {
      console.log(`Sampling ${voice}…`);
      const pcm = await tts(promptFor(scene), voice);
      const sec = await writeWav(path.join(dir, `${voice.toLowerCase()}.wav`), pcm);
      console.log(`  → samples/${voice.toLowerCase()}.wav (${sec.toFixed(1)}s)`);
    }
    console.log(`\nListen: open ${path.relative(process.cwd(), dir)}/*.wav — then rerun with --voice=<name>`);
    return;
  }

  const voice = args.voice;
  if (!voice) {
    console.error("Pass --samples or --voice=<name>");
    process.exit(1);
  }

  const only = args.only ? String(args.only).split(",") : null;
  let manifest = { voice, model: MODEL, scenes: [] };
  if (only && existsSync(MANIFEST)) {
    manifest = JSON.parse(await readFile(MANIFEST, "utf8"));
    manifest.voice = voice;
    manifest.model = MODEL;
  }

  for (const scene of SCENES) {
    if (only && !only.includes(scene.id)) continue;
    console.log(`Generating ${scene.id} (${scene.title})…`);
    const pcm = await tts(promptFor(scene), voice);
    const sec = await writeWav(path.join(AUDIO_DIR, `${scene.id}.wav`), pcm);
    const entry = {
      id: scene.id,
      title: scene.title,
      tempo: scene.tempo,
      targetSec: scene.targetSec,
      vo: scene.vo,
      file: `audio/${scene.id}.wav`,
      durationSec: Number(sec.toFixed(3)),
    };
    const i = manifest.scenes.findIndex((s) => s.id === scene.id);
    if (i >= 0) manifest.scenes[i] = entry;
    else manifest.scenes.push(entry);
    const drift = sec - scene.targetSec;
    console.log(
      `  → ${scene.id}.wav ${sec.toFixed(1)}s (target ${scene.targetSec}s, ${drift >= 0 ? "+" : ""}${drift.toFixed(1)}s)`,
    );
  }

  manifest.scenes.sort(
    (a, b) => SCENES.findIndex((s) => s.id === a.id) - SCENES.findIndex((s) => s.id === b.id),
  );
  manifest.totalSec = Number(
    manifest.scenes.reduce((t, s) => t + s.durationSec, 0).toFixed(1),
  );
  await writeFile(MANIFEST, JSON.stringify(manifest, null, 2));
  console.log(`\nmanifest.json written — VO total ${manifest.totalSec}s (budget ≤170s before padding)`);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
