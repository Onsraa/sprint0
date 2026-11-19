import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { prog, pulse } from "../components/anim";
import { Card, Chip, FlowDot } from "../components/diagram";
import { T } from "../theme";

// A2 · The memory — MongoDB through the official MCP. VO ~20.5s, three phases:
//   1. sprint0 ⇄ MongoDB MCP (stdio) ⇄ Atlas          (0–4.5s)
//   2. $rankFusion: $vectorSearch + $search merge      (4.5–11s)
//   3. code-RAG: in-lane filter → summary match → 1-hop import-graph pull (11s+)
const MONGO = "#00ED64"; // MongoDB brand green — the MCP node owns it

export const A2Mongo: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const sec = frame / fps;

  const trio = [prog(frame, fps, 0.4, 0.5), prog(frame, fps, 0.9, 0.6), prog(frame, fps, 1.5, 0.5)];
  const mcpGlow = pulse(frame, fps, 2.2, 1.2);
  const fusionIn = prog(frame, fps, 4.8, 0.6);
  const streams = [prog(frame, fps, 5.6, 0.6), prog(frame, fps, 6.4, 0.6)];
  const fused = prog(frame, fps, 8.2, 0.6);
  const ragIn = prog(frame, fps, 11.2, 0.6);
  const laneChip = prog(frame, fps, 12.0, 0.5);
  const match = prog(frame, fps, 13.8, 0.5);
  const hops = [0, 1, 2].map((i) => prog(frame, fps, 16.0 + i * 0.4, 0.5));
  const cluster = prog(frame, fps, 18.2, 0.7);

  // top band geometry
  const linkY = 250;

  // import-graph node positions (right panel)
  const FILE = { x: 1330, y: 690 };
  const NEIGHBORS = [
    { x: 1620, y: 590, label: "checkout.ts" },
    { x: 1680, y: 730, label: "webhooks.ts" },
    { x: 1490, y: 795, label: "billing.ts" },
  ];

  return (
    <AbsoluteFill style={{ background: T.bgBase, fontFamily: T.font, color: T.text }}>
      {/* ── phase 1: the trio ── */}
      <svg width={1920} height={1080} style={{ position: "absolute", inset: 0 }}>
        <g opacity={Math.min(trio[1], trio[0])}>
          <line x1={420} y1={linkY} x2={760} y2={linkY} stroke={T.borderStrong} strokeWidth={2} />
        </g>
        <g opacity={Math.min(trio[1], trio[2])}>
          <line x1={1160} y1={linkY} x2={1480} y2={linkY} stroke={T.borderStrong} strokeWidth={2} />
        </g>
        {/* bidirectional pulses through the MCP */}
        {sec > 2.2 && (
          <>
            <FlowDot x1={420} y1={linkY} x2={760} y2={linkY} t={(sec * 0.55) % 1} color={MONGO} />
            <FlowDot x1={760} y1={linkY} x2={420} y2={linkY} t={(sec * 0.45 + 0.4) % 1} color={T.accent} r={4.5} opacity={0.8} />
            <FlowDot x1={1160} y1={linkY} x2={1480} y2={linkY} t={(sec * 0.5 + 0.2) % 1} color={MONGO} />
            <FlowDot x1={1480} y1={linkY} x2={1160} y2={linkY} t={(sec * 0.6 + 0.7) % 1} color={MONGO} r={4.5} opacity={0.8} />
          </>
        )}
        {/* fusion streams (phase 2) */}
        <g opacity={streams[0]}>
          <path d="M 300 555 C 360 620, 420 650, 520 668" fill="none" stroke={T.cyan} strokeWidth={2.5} />
        </g>
        <g opacity={streams[1]}>
          <path d="M 300 775 C 360 730, 420 700, 520 688" fill="none" stroke={T.blue} strokeWidth={2.5} />
        </g>
        {sec > 6.5 && (
          <>
            <FlowDot x1={310} y1={565} x2={520} y2={668} t={(sec * 0.8) % 1} color={T.cyan} r={5} />
            <FlowDot x1={310} y1={765} x2={520} y2={692} t={(sec * 0.8 + 0.5) % 1} color={T.blue} r={5} />
          </>
        )}
        {/* import-graph edges (phase 3) */}
        {NEIGHBORS.map((n, i) => (
          <line
            key={n.label}
            x1={FILE.x}
            y1={FILE.y}
            x2={FILE.x + (n.x - FILE.x) * hops[i]}
            y2={FILE.y + (n.y - FILE.y) * hops[i]}
            stroke={T.orange}
            strokeWidth={2}
            opacity={hops[i]}
          />
        ))}
        {/* cluster ring */}
        {cluster > 0 && (
          <ellipse
            cx={1520}
            cy={705}
            rx={270 * cluster}
            ry={165 * cluster}
            fill="none"
            stroke={`${T.orange}`}
            strokeWidth={1.5}
            strokeDasharray="6 8"
            opacity={cluster * 0.7}
          />
        )}
      </svg>

      <Card x={150} y={190} w={270} enter={trio[0]} color={T.accent} title="sprint0" sub="REASON · every gate" center />
      <Card
        x={760}
        y={170}
        w={400}
        enter={trio[1]}
        color={MONGO}
        title="MongoDB MCP"
        sub="official mongodb-mcp-server · stdio"
        glow={mcpGlow}
        center
      >
        <div style={{ fontSize: 15, color: T.textQuaternary, marginTop: 6 }}>
          every read and write goes through it
        </div>
      </Card>
      <Card x={1480} y={190} w={290} enter={trio[2]} color={T.green} title="Atlas" sub="Vector + Search indexes" center />

      {/* ── phase 2: $rankFusion ── */}
      <div style={{ position: "absolute", left: 100, top: 470, opacity: fusionIn }}>
        <div style={{ fontSize: 21, fontWeight: 600, color: T.textTertiary, letterSpacing: 1.2, textTransform: "uppercase" }}>
          ground the plan
        </div>
      </div>
      <Card x={100} y={505} w={260} enter={streams[0]} color={T.cyan} title="$vectorSearch" sub="Voyage embeddings · 1024d" center />
      <Card x={100} y={725} w={260} enter={streams[1]} color={T.blue} title="$search" sub="full-text" center />
      <Card x={520} y={620} w={250} enter={fused} color={MONGO} title="$rankFusion" sub="native · one query" glow={pulse(frame, fps, 8.8, 0.8)} center />
      <div style={{ position: "absolute", left: 820, top: 612, opacity: prog(frame, fps, 9.4, 0.5) }}>
        {["QuantaPay · Stripe flow", "TrailLog · live tracking", "DeskHR · auth"].map((d, i) => (
          <div
            key={d}
            style={{
              padding: "8px 16px",
              borderRadius: 8,
              border: `0.5px solid ${T.borderStrong}`,
              background: T.bgSecondary,
              fontSize: 15.5,
              color: T.textSecondary,
              marginBottom: 6,
              transform: `translateX(${i * 8}px)`,
            }}
          >
            {d}
          </div>
        ))}
      </div>

      {/* ── phase 3: code-RAG ── */}
      <div style={{ position: "absolute", left: 1040, top: 470, width: 300, opacity: ragIn }}>
        <div style={{ fontSize: 21, fontWeight: 600, color: T.textTertiary, letterSpacing: 1.2, textTransform: "uppercase" }}>
          ground the code
        </div>
        <div style={{ marginTop: 4, display: "flex", flexDirection: "column", alignItems: "flex-start" }}>
          <Chip label="pre-filter · discipline: backend" color={T.accent} enter={laneChip} />
          <Chip label="match on AI file summaries" color={T.cyan} enter={match} />
        </div>
      </div>
      <Card
        x={FILE.x - 130}
        y={FILE.y - 40}
        w={260}
        enter={match}
        color={T.cyan}
        title="stripe.ts"
        sub="summary matched"
        glow={pulse(frame, fps, 14.2, 0.7)}
        center
      />
      {NEIGHBORS.map((n, i) => (
        <div
          key={n.label}
          style={{
            position: "absolute",
            left: n.x - 85,
            top: n.y - 22,
            width: 170,
            padding: "8px 0",
            borderRadius: 9999,
            border: `1px solid ${T.orange}`,
            background: `${T.orange}1A`,
            fontSize: 16.5,
            fontWeight: 500,
            textAlign: "center",
            opacity: hops[i],
            transform: `scale(${hops[i]})`,
            fontFamily: T.mono,
          }}
        >
          {n.label}
        </div>
      ))}
      <div
        style={{
          position: "absolute",
          left: 1040,
          top: 745,
          width: 210,
          fontSize: 17,
          fontWeight: 500,
          color: T.orange,
          lineHeight: 1.45,
          opacity: cluster,
        }}
      >
        1 hop on the stored import graph — the cluster comes along
      </div>
    </AbsoluteFill>
  );
};
