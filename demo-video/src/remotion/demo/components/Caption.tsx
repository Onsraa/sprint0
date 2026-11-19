import React from "react";
import { interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { T } from "../theme";

// Word-timed caption strip. Words are distributed linearly across the VO
// window (leadFrames → leadFrames + voDurationSec); the active word lights up.
export const Caption: React.FC<{
  text: string;
  leadFrames: number;
  voDurationSec: number;
}> = ({ text, leadFrames, voDurationSec }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const words = text.split(" ");
  const voFrames = voDurationSec * fps;
  const progress = (frame - leadFrames) / voFrames; // 0..1 across the VO
  const activeIdx = Math.floor(progress * words.length);

  const opacity = interpolate(
    frame,
    [leadFrames - 8, leadFrames, leadFrames + voFrames, leadFrames + voFrames + 15],
    [0, 1, 1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );

  return (
    <div
      style={{
        position: "absolute",
        bottom: 48,
        left: 0,
        right: 0,
        display: "flex",
        justifyContent: "center",
        opacity,
        fontFamily: T.font,
      }}
    >
      <div
        style={{
          maxWidth: 1280,
          padding: "14px 28px",
          borderRadius: 12,
          background: "rgba(8,9,10,0.82)",
          border: `0.5px solid ${T.border}`,
          fontSize: 28,
          lineHeight: 1.45,
          fontWeight: 500,
          textAlign: "center",
        }}
      >
        {words.map((w, i) => (
          <span
            key={i}
            style={{
              color: i <= activeIdx ? T.text : T.textQuaternary,
              transition: "none",
            }}
          >
            {w}{" "}
          </span>
        ))}
      </div>
    </div>
  );
};
