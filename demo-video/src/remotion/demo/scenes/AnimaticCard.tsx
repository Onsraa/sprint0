import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { Scene } from "../data";
import { T, easeOutExpo } from "../theme";

// Animatic placeholder for a scene: beat title, tempo badge, planned visuals,
// and a gray box for the pending clip. Replaced scene-by-scene with real
// diagram/clip scenes in later passes.
export const AnimaticCard: React.FC<{ scene: Scene; index: number }> = ({
  scene,
  index,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = interpolate(frame, [0, 0.7 * fps], [0, 1], {
    easing: easeOutExpo,
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill
      style={{
        background: T.bgBase,
        fontFamily: T.font,
        color: T.text,
        padding: 96,
        justifyContent: "center",
      }}
    >
      <div style={{ opacity: enter, transform: `translateY(${(1 - enter) * 24}px)` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 18 }}>
          <span
            style={{
              fontSize: 20,
              fontWeight: 500,
              color: T.textQuaternary,
              fontFamily: T.mono,
            }}
          >
            {scene.id.toUpperCase()} · {index + 1}/9
          </span>
          <span
            style={{
              fontSize: 16,
              fontWeight: 500,
              padding: "4px 12px",
              borderRadius: 9999,
              border: `0.5px solid ${T.borderStrong}`,
              color: T.textTertiary,
            }}
          >
            tempo: {scene.tempo}
          </span>
        </div>

        <h1 style={{ fontSize: 72, fontWeight: 600, letterSpacing: -1.5, margin: 0 }}>
          {scene.title}
        </h1>

        <div style={{ marginTop: 40, display: "flex", gap: 48 }}>
          <div style={{ flex: 1, maxWidth: 1100 }}>
            <div style={{ fontSize: 17, fontWeight: 500, color: T.textQuaternary, marginBottom: 14, textTransform: "uppercase", letterSpacing: 1.5 }}>
              Planned visuals
            </div>
            {scene.meta.visuals.map((v, i) => {
              const d = interpolate(frame, [(0.3 + i * 0.15) * fps, (0.8 + i * 0.15) * fps], [0, 1], {
                easing: easeOutExpo,
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
              });
              return (
                <div
                  key={i}
                  style={{
                    fontSize: 26,
                    color: T.textSecondary,
                    marginBottom: 10,
                    opacity: d,
                    transform: `translateX(${(1 - d) * 16}px)`,
                  }}
                >
                  — {v}
                </div>
              );
            })}
          </div>

        </div>
      </div>
    </AbsoluteFill>
  );
};
