import type { CSSProperties, ReactNode } from "react";

/* Zero — the sprint0 mascot. A friendly little 0 with expression variants. */

export type Expression =
  | "happy"
  | "focused"
  | "sleepy"
  | "surprised"
  | "working"
  | "cheer";

interface MascotProps {
  size?: number;
  expression?: Expression;
  color?: string;
  style?: CSSProperties;
  className?: string;
  outline?: string;
  strokeWidth?: number;
}

export function Mascot({
  size = 120,
  expression = "happy",
  color = "var(--orange)",
  style = {},
  className = "",
  outline = "var(--ink)",
  strokeWidth = 5,
}: MascotProps) {
  const eyeSet: Record<Expression, { l: ReactNode; r: ReactNode }> = {
    happy: {
      l: <circle cx="36" cy="46" r="4.5" fill={outline} />,
      r: <circle cx="64" cy="46" r="4.5" fill={outline} />,
    },
    focused: {
      l: <rect x="30" y="44" width="13" height="4" rx="2" fill={outline} />,
      r: <rect x="57" y="44" width="13" height="4" rx="2" fill={outline} />,
    },
    sleepy: {
      l: <path d="M30 46 Q36 50 42 46" stroke={outline} strokeWidth="3.5" fill="none" strokeLinecap="round" />,
      r: <path d="M58 46 Q64 50 70 46" stroke={outline} strokeWidth="3.5" fill="none" strokeLinecap="round" />,
    },
    surprised: {
      l: <circle cx="36" cy="46" r="6" fill={outline} />,
      r: <circle cx="64" cy="46" r="6" fill={outline} />,
    },
    working: {
      l: <circle cx="36" cy="46" r="4.5" fill={outline} />,
      r: <circle cx="64" cy="46" r="4.5" fill={outline} />,
    },
    cheer: {
      l: <path d="M30 50 Q36 42 42 50" stroke={outline} strokeWidth="3.5" fill="none" strokeLinecap="round" />,
      r: <path d="M58 50 Q64 42 70 50" stroke={outline} strokeWidth="3.5" fill="none" strokeLinecap="round" />,
    },
  };

  const mouths: Record<Expression, ReactNode> = {
    happy: <path d="M38 64 Q50 72 62 64" stroke={outline} strokeWidth="4" fill="none" strokeLinecap="round" />,
    focused: <rect x="40" y="62" width="20" height="4" rx="2" fill={outline} />,
    sleepy: <path d="M44 65 Q50 68 56 65" stroke={outline} strokeWidth="3.5" fill="none" strokeLinecap="round" />,
    surprised: <ellipse cx="50" cy="65" rx="6" ry="8" fill={outline} />,
    working: <path d="M40 66 Q50 60 60 66" stroke={outline} strokeWidth="4" fill="none" strokeLinecap="round" />,
    cheer: <path d="M36 62 Q50 80 64 62 Z" fill={outline} />,
  };

  const eyes = eyeSet[expression];

  return (
    <svg viewBox="0 0 100 100" width={size} height={size} className={className} style={style}>
      <ellipse cx="50" cy="92" rx="28" ry="3.5" fill="rgba(0,0,0,0.12)" />
      <g>
        <ellipse cx="50" cy="50" rx="40" ry="42" fill={color} stroke={outline} strokeWidth={strokeWidth} />
        <ellipse cx="50" cy="48" rx="8" ry="10" fill="rgba(255,255,255,0.18)" />
        <ellipse cx="34" cy="28" rx="9" ry="6" fill="rgba(255,255,255,0.35)" transform="rotate(-25 34 28)" />
      </g>
      {eyes.l}
      {eyes.r}
      {mouths[expression]}
    </svg>
  );
}

/* Tiny inline mark (logo lock-up) */
export function MascotMark({
  size = 28,
  color = "var(--orange)",
  outline = "var(--ink)",
}: {
  size?: number;
  color?: string;
  outline?: string;
}) {
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} style={{ flexShrink: 0 }}>
      <ellipse cx="50" cy="50" rx="42" ry="44" fill={color} stroke={outline} strokeWidth="6" />
      <circle cx="38" cy="46" r="5" fill={outline} />
      <circle cx="62" cy="46" r="5" fill={outline} />
      <path d="M38 64 Q50 72 62 64" stroke={outline} strokeWidth="5" fill="none" strokeLinecap="round" />
    </svg>
  );
}

/* Logo lock-up: mark + wordmark. markColor tints both the mark and the "0". */
export function Sprint0Logo({
  size = 24,
  color = "var(--ink)",
  markColor = "var(--orange)",
  markOutline = "var(--ink)",
}: {
  size?: number;
  color?: string;
  markColor?: string;
  markOutline?: string;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <MascotMark size={size + 6} color={markColor} outline={markOutline} />
      <span
        style={{
          fontFamily: "var(--font-display)",
          fontWeight: 800,
          fontSize: size,
          letterSpacing: "-0.03em",
          color,
        }}
      >
        sprint<span style={{ color: markColor }}>0</span>
      </span>
    </div>
  );
}
