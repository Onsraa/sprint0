import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { prog } from "../components/anim";
import { T, easeOutQuart } from "../theme";

// A0 · Title slam — "Here's how it works under the hood." (~4.3s VO)
export const A0Title: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const l1 = prog(frame, fps, 0.25, 0.45);
  const l2 = prog(frame, fps, 0.9, 0.5, easeOutQuart);
  const rule = prog(frame, fps, 1.4, 0.6);

  return (
    <AbsoluteFill
      style={{
        background: T.bgBase,
        fontFamily: T.font,
        justifyContent: "center",
        alignItems: "center",
      }}
    >
      <AbsoluteFill
        style={{
          background: `radial-gradient(ellipse at 50% 45%, rgba(94,106,210,0.08), transparent 60%)`,
        }}
      />
      <div style={{ textAlign: "center" }}>
        <div
          style={{
            fontSize: 30,
            fontWeight: 500,
            letterSpacing: 6,
            textTransform: "uppercase",
            color: T.textTertiary,
            opacity: l1,
            transform: `translateY(${(1 - l1) * 18}px)`,
          }}
        >
          sprint<span style={{ color: T.accent }}>0</span> · architecture
        </div>
        <div
          style={{
            fontSize: 108,
            fontWeight: 700,
            letterSpacing: -4,
            color: T.text,
            marginTop: 18,
            opacity: l2,
            transform: `scale(${0.94 + l2 * 0.06})`,
          }}
        >
          Under the hood
        </div>
        <div
          style={{
            margin: "34px auto 0",
            height: 2,
            width: rule * 560,
            background: `linear-gradient(90deg, transparent, ${T.accent}, transparent)`,
          }}
        />
      </div>
    </AbsoluteFill>
  );
};
