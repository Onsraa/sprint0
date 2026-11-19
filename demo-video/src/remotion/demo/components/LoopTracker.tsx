import React from "react";
import { interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { LOOP_STAGES, LoopStage } from "../data";
import { T, easeOutExpo } from "../theme";

// Chapter tracker: memory → ratify → verify → compound.
// Top-right pill row; the active stage is lit, past stages stay dimly lit.
export const LoopTracker: React.FC<{
  active: LoopStage | "none" | "all";
}> = ({ active }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  if (active === "none") return null;

  const appear = interpolate(frame, [0, 0.6 * fps], [0, 1], {
    easing: easeOutExpo,
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const activeIdx = active === "all" ? LOOP_STAGES.length : LOOP_STAGES.indexOf(active);

  return (
    <div
      style={{
        position: "absolute",
        top: 36,
        right: 48,
        display: "flex",
        gap: 10,
        alignItems: "center",
        opacity: appear,
        transform: `translateY(${(1 - appear) * -12}px)`,
        fontFamily: T.font,
      }}
    >
      {LOOP_STAGES.map((stage, i) => {
        const isActive = active === "all" || i === activeIdx;
        const isPast = active !== "all" && i < activeIdx;
        const color = T.stage[stage];
        return (
          <React.Fragment key={stage}>
            {i > 0 && (
              <div style={{ width: 14, height: 1, background: T.borderStrong }} />
            )}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 7,
                padding: "6px 12px",
                borderRadius: 9999,
                border: `0.5px solid ${isActive ? color : T.border}`,
                background: isActive ? `${color}1A` : "transparent",
                opacity: isActive ? 1 : isPast ? 0.7 : 0.35,
              }}
            >
              <div
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: "50%",
                  background: isActive || isPast ? color : T.textQuaternary,
                }}
              />
              <span
                style={{
                  fontSize: 15,
                  fontWeight: 500,
                  color: isActive ? T.text : T.textTertiary,
                  letterSpacing: 0.2,
                }}
              >
                {stage}
              </span>
            </div>
          </React.Fragment>
        );
      })}
    </div>
  );
};
