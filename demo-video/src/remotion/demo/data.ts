import manifest from "../../../public/audio/manifest.json";

// ---- video format ----
export const FPS = 30;
export const WIDTH = 1920;
export const HEIGHT = 1080;
export const MAX_DURATION_SEC = 110; // architecture segment budget (live demo takes the rest)

// ---- loop tracker stages ----
export type LoopStage = "memory" | "ratify" | "verify" | "compound";
export const LOOP_STAGES: LoopStage[] = ["memory", "ratify", "verify", "compound"];

// ---- per-scene production metadata ----
// leadSec = silence before VO starts · holdSec = visual tail after VO ends.
// Fast rhythm: short leads, short holds.
type SceneMeta = {
  leadSec: number;
  holdSec: number;
  stage: LoopStage | "none" | "all";
  visuals: string[];
  noCaption?: boolean; // kinetic-type scenes already show the words
};

export const SCENE_META: Record<string, SceneMeta> = {
  a0: {
    leadSec: 0.2,
    holdSec: 0.5,
    stage: "none",
    visuals: ["Kinetic title: Under the hood"],
    noCaption: true,
  },
  a1: {
    leadSec: 0.3,
    holdSec: 0.8,
    stage: "none",
    visuals: ["Pipeline: brief → REASON (Gemini·Vertex·ADK) → PlanJSON → EXECUTE (FastAPI) → GitLab"],
  },
  a2: {
    leadSec: 0.3,
    holdSec: 1.0,
    stage: "memory",
    visuals: ["sprint0 ⇄ MongoDB MCP ⇄ Atlas", "$rankFusion funnel", "import-graph 1-hop expansion"],
  },
  a3: {
    leadSec: 0.3,
    holdSec: 0.8,
    stage: "ratify",
    visuals: ["Relay DAG", "3 contract cards — reuse wired to memory", "human ratifies"],
  },
  a4: {
    leadSec: 0.3,
    holdSec: 0.8,
    stage: "verify",
    visuals: ["GitLab merge events → tester checklist flips", "interface Contract verified"],
  },
  a5: {
    leadSec: 0.3,
    holdSec: 0.8,
    stage: "compound",
    visuals: ["Write-back through the same MCP", "passport radar bumps", "loop ring closes"],
  },
  a6: {
    leadSec: 0.4,
    holdSec: 2.5,
    stage: "all",
    visuals: ["Loop assembled", "stack marks"],
    noCaption: true,
  },
};

// ---- timing, computed from the TTS manifest (audio-first) ----
export type Scene = {
  id: string;
  title: string;
  tempo: string;
  vo: string;
  audioFile: string;
  voDurationSec: number;
  leadFrames: number;
  durationInFrames: number;
  meta: SceneMeta;
};

export const SCENES: Scene[] = manifest.scenes.map((s) => {
  const meta = SCENE_META[s.id];
  if (!meta) throw new Error(`SCENE_META missing for ${s.id}`);
  return {
    id: s.id,
    title: s.title,
    tempo: s.tempo,
    vo: s.vo,
    audioFile: s.file,
    voDurationSec: s.durationSec,
    leadFrames: Math.round(meta.leadSec * FPS),
    durationInFrames: Math.round((meta.leadSec + s.durationSec + meta.holdSec) * FPS),
    meta,
  };
});

export const TOTAL_DURATION_IN_FRAMES = SCENES.reduce(
  (t, s) => t + s.durationInFrames,
  0,
);

if (TOTAL_DURATION_IN_FRAMES > MAX_DURATION_SEC * FPS) {
  throw new Error(
    `Segment too long: ${(TOTAL_DURATION_IN_FRAMES / FPS).toFixed(1)}s > ${MAX_DURATION_SEC}s — trim holdSec in SCENE_META`,
  );
}
