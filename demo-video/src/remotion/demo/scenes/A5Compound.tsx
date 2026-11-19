import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { prog, pulse } from "../components/anim";
import { Card, FlowDot } from "../components/diagram";
import { T } from "../theme";

// A5 · Compound — shipped work + ratified decisions write back through the
// SAME MCP into memory; passports bump per merge; the loop closes. VO ~9.9s.
const MONGO = "#00ED64";

const WRITES = [
  { label: "+ shipped project", at: 2.6 },
  { label: "+ ratified decisions", at: 3.3 },
  { label: "+ contracts · outcomes", at: 4.0 },
];

// pentagon radar for the passport
const SKILLS = ["backend", "devops", "frontend", "qa", "uiux"];
const radarPoint = (i: number, v: number, cx: number, cy: number, r: number) => {
  const a = (-90 + i * 72) * (Math.PI / 180);
  return `${cx + r * v * Math.cos(a)},${cy + r * v * Math.sin(a)}`;
};

export const A5Compound: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const sec = frame / fps;

  const head = prog(frame, fps, 0.2, 0.5);
  const ship = prog(frame, fps, 0.6, 0.5);
  const mcp = prog(frame, fps, 1.4, 0.5);
  const mcpGlow = pulse(frame, fps, 2.4, 1.0);
  const radarIn = prog(frame, fps, 5.4, 0.6);
  const bump = prog(frame, fps, 6.3, 0.8);
  const smarter = prog(frame, fps, 8.0, 0.6);

  const RC = { x: 1560, y: 700, r: 130 };
  const base = [0.55, 0.45, 0.5, 0.6, 0.35];
  const bumped = [0.75, 0.62, 0.5, 0.6, 0.35]; // backend + devops grow on this merge
  const vals = base.map((b, i) => b + (bumped[i] - b) * bump);

  return (
    <AbsoluteFill style={{ background: T.bgBase, fontFamily: T.font, color: T.text }}>
      <div style={{ position: "absolute", left: 96, top: 88, opacity: head }}>
        <h1 style={{ fontSize: 54, fontWeight: 600, letterSpacing: -1.5, margin: 0 }}>
          Shipping <span style={{ color: MONGO }}>feeds the brain</span>
        </h1>
      </div>

      {/* write-back flow */}
      <svg width={1920} height={1080} style={{ position: "absolute", inset: 0 }}>
        <line x1={440} y1={420} x2={620} y2={420} stroke={T.borderStrong} strokeWidth={2} opacity={mcp} />
        <line x1={1030} y1={420} x2={1180} y2={420} stroke={T.borderStrong} strokeWidth={2} opacity={mcp} />
        {sec > 2.2 && (
          <>
            <FlowDot x1={440} y1={420} x2={620} y2={420} t={(sec * 0.7) % 1} color={MONGO} />
            <FlowDot x1={1030} y1={420} x2={1180} y2={420} t={(sec * 0.7 + 0.35) % 1} color={MONGO} />
          </>
        )}
        {/* radar */}
        <g opacity={radarIn}>
          {[0.33, 0.66, 1].map((g) => (
            <polygon
              key={g}
              points={SKILLS.map((_, i) => radarPoint(i, g, RC.x, RC.y, RC.r)).join(" ")}
              fill="none"
              stroke={T.border}
              strokeWidth={1}
            />
          ))}
          <polygon
            points={SKILLS.map((_, i) => radarPoint(i, vals[i], RC.x, RC.y, RC.r)).join(" ")}
            fill={`${T.accent}33`}
            stroke={T.accent}
            strokeWidth={2.5}
          />
        </g>
      </svg>

      <Card x={120} y={356} w={320} enter={ship} color={T.green} title="🚀 project ships" sub="verified · accepted" center />
      <Card
        x={620}
        y={336}
        w={410}
        enter={mcp}
        color={MONGO}
        title="MongoDB MCP"
        sub="the SAME server — now writing"
        glow={mcpGlow}
        center
      />
      <div style={{ position: "absolute", left: 1180, top: 340 }}>
        {WRITES.map((w) => {
          const e = prog(frame, fps, w.at, 0.45);
          return (
            <div
              key={w.label}
              style={{
                padding: "10px 18px",
                borderRadius: 8,
                border: `0.5px solid ${MONGO}`,
                background: `${MONGO}10`,
                fontSize: 18,
                fontWeight: 500,
                marginBottom: 8,
                opacity: e,
                transform: `translateX(${(1 - e) * 24}px)`,
              }}
            >
              {w.label}
            </div>
          );
        })}
        <div style={{ fontSize: 15.5, color: T.textQuaternary, marginTop: 4 }}>
          memory collections — the next brief grounds on these
        </div>
      </div>

      {/* passport */}
      <div style={{ position: "absolute", left: 700, top: 600, opacity: radarIn }}>
        <div style={{ fontSize: 26, fontWeight: 600 }}>Passport — per-skill trust</div>
        <div style={{ fontSize: 19, color: T.textTertiary, marginTop: 8, maxWidth: 420, lineHeight: 1.5 }}>
          every merge credits its owner&apos;s skill
        </div>
        <div
          style={{
            marginTop: 16,
            display: "inline-block",
            padding: "8px 18px",
            borderRadius: 9999,
            border: `1px solid ${T.accent}`,
            background: `${T.accent}1A`,
            fontSize: 18,
            fontWeight: 600,
            opacity: bump,
            transform: `scale(${1 + pulse(frame, fps, 6.6, 0.8) * 0.07})`,
          }}
        >
          ▲ backend +trust · devops +trust
        </div>
      </div>

      {/* radar labels */}
      {SKILLS.map((s, i) => {
        const a = (-90 + i * 72) * (Math.PI / 180);
        return (
          <div
            key={s}
            style={{
              position: "absolute",
              left: RC.x + (RC.r + 42) * Math.cos(a) - 50,
              top: RC.y + (RC.r + 36) * Math.sin(a) - 14,
              width: 100,
              textAlign: "center",
              fontSize: 17,
              fontWeight: 500,
              color: i < 2 && bump > 0.3 ? T.accentLight : T.textTertiary,
              opacity: radarIn,
            }}
          >
            {s}
          </div>
        );
      })}

      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 268,
          textAlign: "center",
          fontSize: 27,
          fontWeight: 600,
          color: T.text,
          opacity: smarter,
          transform: `translateY(${(1 - smarter) * 14}px)`,
        }}
      >
        the next brief starts <span style={{ color: MONGO }}>smarter</span>
      </div>
    </AbsoluteFill>
  );
};
