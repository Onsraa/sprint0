import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { prog, pulse } from "../components/anim";
import { Chip } from "../components/diagram";
import { T } from "../theme";

// A3 · Ratify — relay gates; each gate = three contracts; the reuse card is
// wired live back to memory; a human ratifies. VO ~10.4s.
const MONGO = "#00ED64";

const LANES = [
  { label: "uiux", x: 250, y: 240 },
  { label: "backend", x: 450, y: 240 },
  { label: "devops", x: 650, y: 240 },
  { label: "frontend", x: 950, y: 240 },
  { label: "qa", x: 1200, y: 240 },
];

const CARDS = [
  {
    icon: "♻",
    title: "Reuse",
    sub: "QuantaPay Stripe flow · prod-survived",
    note: "conf 86 · pulled from memory",
    color: MONGO,
    at: 2.2,
  },
  { icon: "✦", title: "Fresh", sub: "new adapter, current stack", note: "conf 64 · when memory shouldn't win", color: T.cyan, at: 3.1 },
  { icon: "✎", title: "Write your own", sub: "type an approach — the AI adapts the task", note: "never a cage", color: T.textTertiary, at: 3.9 },
];

export const A3Ratify: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const head = prog(frame, fps, 0.3, 0.5);
  const dag = prog(frame, fps, 0.6, 0.7);
  const gateGlow = pulse(frame, fps, 1.7, 1.0);
  const memLine = prog(frame, fps, 2.6, 0.7);
  const pick = prog(frame, fps, 6.7, 0.5);
  const stamp = prog(frame, fps, 7.5, 0.5);
  const owner = prog(frame, fps, 8.6, 0.6);

  return (
    <AbsoluteFill style={{ background: T.bgBase, fontFamily: T.font, color: T.text }}>
      <div style={{ position: "absolute", left: 96, top: 88, opacity: head }}>
        <h1 style={{ fontSize: 54, fontWeight: 600, letterSpacing: -1.5, margin: 0 }}>
          Every gate is a <span style={{ color: T.accent }}>choice</span>
        </h1>
      </div>

      {/* compact relay DAG */}
      <svg width={1920} height={1080} style={{ position: "absolute", inset: 0 }}>
        {LANES.slice(0, 3).map((l) => (
          <line key={l.label} x1={l.x + 60} y1={l.y} x2={950 - 75} y2={LANES[3].y} stroke={T.borderStrong} strokeWidth={1.5} opacity={dag * 0.8} />
        ))}
        <line x1={950 + 75} y1={LANES[3].y} x2={1200 - 50} y2={LANES[4].y} stroke={T.borderStrong} strokeWidth={1.5} opacity={dag * 0.8} />
        {/* memory line into the reuse card */}
        <path
          d={`M 1620 250 C 1500 380, 760 320, 420 470`}
          fill="none"
          stroke={MONGO}
          strokeWidth={2.5}
          strokeDasharray={1400}
          strokeDashoffset={(1 - memLine) * 1400}
          opacity={0.85}
        />
      </svg>

      {LANES.map((l, i) => {
        const isOpen = l.label === "backend";
        return (
          <div
            key={l.label}
            style={{
              position: "absolute",
              left: l.x - 75,
              top: l.y - 26,
              width: 150,
              padding: "10px 0",
              textAlign: "center",
              borderRadius: 9999,
              fontSize: 19,
              fontWeight: 600,
              border: `1px solid ${isOpen ? T.accent : T.borderStrong}`,
              background: isOpen ? `${T.accent}22` : T.bg,
              opacity: dag,
              transform: `translateY(${(1 - dag) * 16}px) scale(${1 + (isOpen ? gateGlow * 0.08 : 0)})`,
              boxShadow: isOpen && gateGlow > 0 ? `0 0 ${gateGlow * 30}px ${T.accent}66` : "none",
              transitionDelay: `${i * 40}ms`,
            }}
          >
            {l.label}
          </div>
        );
      })}

      {/* memory source marker */}
      <div
        style={{
          position: "absolute",
          left: 1530,
          top: 210,
          padding: "10px 20px",
          borderRadius: 9999,
          border: `1px solid ${MONGO}`,
          background: `${MONGO}14`,
          fontSize: 18,
          fontWeight: 600,
          opacity: memLine,
        }}
      >
        ⛁ memory · MongoDB MCP
      </div>

      {/* contract cards */}
      {CARDS.map((c, i) => {
        const enter = prog(frame, fps, c.at, 0.55);
        const isPicked = i === 0 && pick > 0;
        return (
          <div
            key={c.title}
            style={{
              position: "absolute",
              left: 180 + i * 540,
              top: 470,
              width: 480,
              padding: "26px 30px",
              borderRadius: 12,
              border: `1.5px solid ${isPicked ? MONGO : T.borderStrong}`,
              background: T.bg,
              opacity: enter,
              transform: `translateY(${(1 - enter) * 36}px) scale(${1 + (isPicked ? pick * 0.03 : 0)})`,
              boxShadow: isPicked ? `0 0 ${pick * 44}px ${MONGO}44` : "none",
            }}
          >
            <div style={{ fontSize: 30, fontWeight: 600, color: c.color }}>
              {c.icon} {c.title}
            </div>
            <div style={{ fontSize: 20, color: T.textSecondary, marginTop: 10 }}>{c.sub}</div>
            <div style={{ fontSize: 16.5, color: T.textQuaternary, marginTop: 6 }}>{c.note}</div>
            {isPicked && (
              <div
                style={{
                  marginTop: 16,
                  display: "inline-block",
                  padding: "7px 18px",
                  borderRadius: 9999,
                  background: `${MONGO}22`,
                  border: `1px solid ${MONGO}`,
                  fontSize: 17,
                  fontWeight: 600,
                  opacity: stamp,
                }}
              >
                ✓ ratified — by the backend lead
              </div>
            )}
          </div>
        );
      })}

      {/* owner tag */}
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: 850,
          textAlign: "center",
          opacity: owner,
          transform: `translateY(${(1 - owner) * 16}px)`,
        }}
      >
        <Chip label="a HUMAN ratifies every gate — nothing auto-approves" color={T.accent} style={{ fontSize: 19, padding: "8px 22px" }} />
        <Chip label="one gate · one owner" color={T.accent} style={{ fontSize: 19, padding: "8px 22px" }} />
      </div>
    </AbsoluteFill>
  );
};
