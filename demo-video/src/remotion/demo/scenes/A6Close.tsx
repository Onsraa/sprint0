import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { prog, pulse } from "../components/anim";
import { LOOP_STAGES } from "../data";
import { T, easeInOutQuart } from "../theme";

// A6 · Close — the loop assembles fast, stages light to the VO words,
// stack marks land, fade out. VO ~6.7s.
const CX = 960;
const CY = 460;
const R = 210;
const CIRC = 2 * Math.PI * R;
const ANGLES = [-90, 0, 90, 180];
const STAGE_AT = [0.7, 1.35, 2.0, 2.65]; // "Memory, ratify, verify, compound."

export const A6Close: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { durationInFrames } = useVideoConfig();

  const draw = prog(frame, fps, 0.4, 1.2, easeInOutQuart);
  const marks = prog(frame, fps, 3.6, 0.7);
  const fadeOut = interpolate(frame, [durationInFrames - 22, durationInFrames - 3], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill style={{ background: T.bgBase, fontFamily: T.font, color: T.text }}>
      <AbsoluteFill
        style={{
          background: `radial-gradient(ellipse at 50% 42%, rgba(94,106,210,0.08), transparent 58%)`,
        }}
      />
      {/* circle */}
      <svg width={1920} height={1080} style={{ position: "absolute", inset: 0 }}>
        <circle
          cx={CX}
          cy={CY}
          r={R}
          fill="none"
          stroke={T.borderStrong}
          strokeWidth={2}
          strokeDasharray={CIRC}
          strokeDashoffset={(1 - draw) * CIRC}
          transform={`rotate(-90 ${CX} ${CY})`}
          strokeLinecap="round"
        />
      </svg>

      {/* center wordmark */}
      <div
        style={{
          position: "absolute",
          left: CX,
          top: CY,
          transform: "translate(-50%, -50%)",
          textAlign: "center",
          opacity: draw,
        }}
      >
        <div style={{ fontSize: 56, fontWeight: 700, letterSpacing: -2 }}>
          sprint<span style={{ color: T.accent }}>0</span>
        </div>
        <div style={{ fontSize: 20, color: T.textTertiary, marginTop: 4 }}>one loop</div>
      </div>

      {/* stage nodes */}
      {LOOP_STAGES.map((stage, i) => {
        const a = (ANGLES[i] * Math.PI) / 180;
        const x = CX + R * Math.cos(a);
        const y = CY + R * Math.sin(a);
        const reached = draw >= (i + 1) / 4 - 0.02;
        const lit = prog(frame, fps, STAGE_AT[i], 0.35);
        const p = pulse(frame, fps, STAGE_AT[i], 0.6);
        const color = T.stage[stage];
        return (
          <div
            key={stage}
            style={{
              position: "absolute",
              left: x,
              top: y,
              transform: `translate(-50%, -50%) scale(${(reached ? 1 : 0) * (1 + p * 0.16)})`,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 8,
            }}
          >
            <div
              style={{
                width: 20,
                height: 20,
                borderRadius: "50%",
                background: lit ? color : T.bgTertiary,
                border: `2px solid ${lit ? color : T.borderStrong}`,
                boxShadow: lit ? `0 0 ${18 + p * 22}px ${color}66` : "none",
              }}
            />
            <div
              style={{
                fontSize: 25,
                fontWeight: 600,
                color: lit ? T.text : T.textTertiary,
                background: T.bgBase,
                padding: "2px 12px",
                borderRadius: 9999,
                border: `0.5px solid ${lit ? color : T.border}`,
              }}
            >
              {stage}
            </div>
          </div>
        );
      })}

      {/* stack marks */}
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: 800,
          display: "flex",
          gap: 24,
          justifyContent: "center",
          opacity: marks,
          transform: `translateY(${(1 - marks) * 18}px)`,
        }}
      >
        {["Gemini on Vertex AI", "Google Cloud Agent Builder", "MongoDB MCP"].map((m, i) => (
          <div
            key={m}
            style={{
              padding: "11px 26px",
              borderRadius: 9999,
              border: `0.5px solid ${i === 2 ? "#00ED64" : T.borderStrong}`,
              background: i === 2 ? "#00ED6414" : T.bg,
              fontSize: 21,
              fontWeight: 500,
              color: T.textSecondary,
            }}
          >
            {m}
          </div>
        ))}
      </div>

      <AbsoluteFill style={{ background: T.bgBase, opacity: fadeOut }} />
    </AbsoluteFill>
  );
};
