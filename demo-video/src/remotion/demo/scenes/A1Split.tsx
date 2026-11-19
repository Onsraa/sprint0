import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { prog } from "../components/anim";
import { Card, Chip, FlowDot } from "../components/diagram";
import { T } from "../theme";

// A1 · REASON/EXECUTE split — the deterministic pipeline. VO ~12.5s:
// brief → REASON (Gemini·Vertex·ADK → schema-validated PlanJSON, no tool loop)
// → EXECUTE (FastAPI → real GitLab calls).
const Y = 450; // pipeline band top
const MID = Y + 62; // arrow centerline

export const A1Split: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const sec = frame / fps;

  const head = prog(frame, fps, 0.3, 0.5);
  const brief = prog(frame, fps, 0.6, 0.5);
  const reason = prog(frame, fps, 1.7, 0.6);
  const chips = [prog(frame, fps, 2.6, 0.4), prog(frame, fps, 3.0, 0.4), prog(frame, fps, 3.4, 0.4)];
  const plan = prog(frame, fps, 5.2, 0.5);
  const detTag = prog(frame, fps, 7.3, 0.5);
  const execute = prog(frame, fps, 8.8, 0.5);
  const gitlab = prog(frame, fps, 10.6, 0.5);

  const arrows: Array<[number, number, number]> = [
    // x1, x2, enter
    [320, 396, brief],
    [824, 876, plan],
    [1134, 1196, execute],
    [1534, 1596, gitlab],
  ];

  return (
    <AbsoluteFill style={{ background: T.bgBase, fontFamily: T.font, color: T.text }}>
      <div style={{ position: "absolute", left: 96, top: 96, opacity: head }}>
        <h1 style={{ fontSize: 54, fontWeight: 600, letterSpacing: -1.5, margin: 0 }}>
          One brief, <span style={{ color: T.accent }}>two brains</span>
        </h1>
        <div style={{ fontSize: 23, color: T.textTertiary, marginTop: 8 }}>
          reasoning and execution never share a loop
        </div>
      </div>

      <svg width={1920} height={1080} style={{ position: "absolute", inset: 0 }}>
        {arrows.map(([x1, x2, e], i) => (
          <g key={i} opacity={e}>
            <line x1={x1} y1={MID} x2={x2} y2={MID} stroke={T.borderStrong} strokeWidth={2} />
            <polygon points={`${x2},${MID - 6} ${x2 + 10},${MID} ${x2},${MID + 6}`} fill={T.borderStrong} />
          </g>
        ))}
        {/* packets: brief→plan (accent), plan→gitlab (green) */}
        {sec > 5.5 && (
          <>
            <FlowDot x1={320} y1={MID} x2={876} y2={MID} t={(sec * 0.45) % 1} color={T.accent} opacity={0.9} />
            {sec > 9.5 && (
              <FlowDot x1={1134} y1={MID} x2={1800} y2={MID} t={(sec * 0.5 + 0.3) % 1} color={T.green} opacity={0.9} />
            )}
          </>
        )}
      </svg>

      <Card x={130} y={Y} w={190} enter={brief} title="📄 brief" sub="the client ask" center />

      <Card x={400} y={Y - 40} w={424} enter={reason} color={T.accent} title="REASON" sub="plans — never executes">
        <div>
          <Chip label="Gemini" color={T.accent} enter={chips[0]} />
          <Chip label="Vertex AI" color={T.accent} enter={chips[1]} />
          <Chip label="Agent Builder · ADK" color={T.accent} enter={chips[2]} />
        </div>
      </Card>

      <Card x={880} y={Y - 14} w={254} enter={plan} color={T.cyan} title="PlanJSON" sub="schema-validated · typed" center />
      <div
        style={{
          position: "absolute",
          left: 880,
          top: Y + 116,
          width: 254,
          textAlign: "center",
          fontSize: 17,
          fontWeight: 500,
          color: T.yellow,
          opacity: detTag,
          transform: `translateY(${(1 - detTag) * 10}px)`,
        }}
      >
        no tool loop · deterministic
      </div>

      <Card x={1200} y={Y - 28} w={334} enter={execute} color={T.green} title="EXECUTE" sub="FastAPI gateway">
        <div>
          <Chip label="GitLab REST" color={T.green} enter={execute} />
          <Chip label="batched" color={T.green} enter={execute} />
        </div>
      </Card>

      <Card x={1600} y={Y - 8} w={200} enter={gitlab} color={T.orange} title="GitLab" sub="real project" center />
    </AbsoluteFill>
  );
};
