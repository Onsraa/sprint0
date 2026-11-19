import { Easing, interpolate } from "remotion";
import { easeOutExpo } from "../theme";

// Normalized progress 0→1 over [startSec, startSec+durSec], clamped.
// Separate timing from mapping (remotion-best-practices/timing).
export const prog = (
  frame: number,
  fps: number,
  startSec: number,
  durSec: number,
  easing: (t: number) => number = easeOutExpo,
): number =>
  interpolate(frame, [startSec * fps, (startSec + durSec) * fps], [0, 1], {
    easing,
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

// Quick pulse: 0→1→0 around a moment.
export const pulse = (
  frame: number,
  fps: number,
  atSec: number,
  durSec = 0.6,
): number =>
  interpolate(
    frame,
    [atSec * fps, (atSec + durSec / 2) * fps, (atSec + durSec) * fps],
    [0, 1, 0],
    {
      easing: Easing.inOut(Easing.quad),
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    },
  );
