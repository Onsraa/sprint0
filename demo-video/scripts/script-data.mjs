// Single source of truth for the demo-video narration script.
// Edit VO here → run `node scripts/generate-vo.mjs --voice=<name>` → Remotion
// consumes public/audio/manifest.json. Never edit the manifest by hand.
//
// Segment = the ARCHITECTURE EXPLAINER (second half of the submission video;
// the live-app demo half is recorded separately by the user).
//
// `style` is a Gemini-TTS delivery instruction prepended to the line (controls tempo).
// `targetSec` is the storyboard's nominal slot — sanity check only.

export const NARRATION_BASE_STYLE =
  "Narrate for a fast-paced technical explainer video: confident, crisp, energetic but precise. Brisk pace, no radio-announcer affect.";

export const SCENES = [
  {
    id: "a0",
    title: "Under the hood",
    tempo: "dynamic",
    targetSec: 3,
    style: "Quick, punchy — a section title.",
    vo: "Here's how it works under the hood.",
  },
  {
    id: "a1",
    title: "REASON / EXECUTE",
    tempo: "fast",
    targetSec: 13,
    style: "Brisk and clear. Tiny beat between 'REASON' and 'EXECUTE' halves.",
    vo: "One brief, two brains. REASON — Gemini on Vertex AI, through Google Cloud Agent Builder — emits a schema-validated plan. No tool loop, deterministic. EXECUTE — a FastAPI gateway — drives real GitLab calls.",
  },
  {
    id: "a2",
    title: "MongoDB MCP — the memory",
    tempo: "centerpiece",
    targetSec: 20,
    style: "Engaged and precise — this is the centerpiece. Keep the pace up but articulate the technical terms cleanly.",
    vo: "Memory is MongoDB — spoken to through the official MongoDB MCP server. Every plan grounds live: rank-fusion merges vector search over Voyage embeddings with full-text search. Code retrieval goes further: each gate searches its own lane, matches on AI-written file summaries, and expands one hop along the import graph — a match brings its whole dependency cluster.",
  },
  {
    id: "a3",
    title: "Ratify",
    tempo: "fast",
    targetSec: 13,
    style: "Brisk. Land 'One gate, one owner' as a clean button.",
    vo: "The plan enters a relay. Each gate offers three contracts: reuse — pulled straight from memory — fresh, or write your own. A human ratifies every gate. One gate, one owner.",
  },
  {
    id: "a4",
    title: "Verify",
    tempo: "fast",
    targetSec: 12,
    style: "Brisk, matter-of-fact.",
    vo: "Ratification dispatches real GitLab work. Merges flow back: each one flips the tester's acceptance checklist from awaiting to ready — and interface contracts are verified against what actually shipped.",
  },
  {
    id: "a5",
    title: "Compound",
    tempo: "build",
    targetSec: 13,
    style: "Quiet intensity, rising. Slight lift on 'smarter'.",
    vo: "Then it compounds. Shipped projects and ratified decisions write back through the same MCP into memory. Every merge bumps the owner's passport — per-skill trust. The next brief starts smarter.",
  },
  {
    id: "a6",
    title: "Close",
    tempo: "calm",
    targetSec: 6,
    style: "Final, resolved. Even pace; a small beat between the four loop words.",
    vo: "Memory, ratify, verify, compound. One loop — on Gemini, Google Cloud, and the MongoDB MCP.",
  },
];

// Representative line for voice auditioning (--samples mode).
export const SAMPLE_SCENE_ID = "a2";

// Voice candidates for the audition. Gemini prebuilt voices.
export const VOICE_CANDIDATES = ["Charon", "Kore", "Puck"];
