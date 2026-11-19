import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { prog, pulse } from "../components/anim";
import { Card, FlowDot } from "../components/diagram";
import { T } from "../theme";

// A4 · Verify — merges flow back from GitLab; each flips the tester's
// acceptance checklist awaiting → ready; interface contracts are checked
// against merged reality. VO ~9.9s.

const MRS = [
  { label: "!1 · payment-api", mergeAt: 3.0 },
  { label: "!2 · checkout-ui", mergeAt: 4.3 },
];
const CHECKS = [
  { label: "payment flow accepted", readyAt: 3.6 },
  { label: "checkout renders", readyAt: 4.9 },
];

export const A4Verify: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const sec = frame / fps;

  const head = prog(frame, fps, 0.3, 0.5);
  const gitlabIn = prog(frame, fps, 0.6, 0.5);
  const checklistIn = prog(frame, fps, 1.4, 0.5);
  const verdict = prog(frame, fps, 5.8, 0.5);
  const contractIn = prog(frame, fps, 6.6, 0.6);
  const contractOk = prog(frame, fps, 8.0, 0.5);

  return (
    <AbsoluteFill style={{ background: T.bgBase, fontFamily: T.font, color: T.text }}>
      <div style={{ position: "absolute", left: 96, top: 88, opacity: head }}>
        <h1 style={{ fontSize: 54, fontWeight: 600, letterSpacing: -1.5, margin: 0 }}>
          Merges drive the <span style={{ color: T.yellow }}>acceptance gate</span>
        </h1>
        <div style={{ fontSize: 23, color: T.textTertiary, marginTop: 8 }}>
          state comes from GitLab — verdicts come from a human
        </div>
      </div>

      {/* event flow lines */}
      <svg width={1920} height={1080} style={{ position: "absolute", inset: 0 }}>
        <line x1={560} y1={560} x2={760} y2={560} stroke={T.borderStrong} strokeWidth={2} opacity={checklistIn} />
        <line x1={1310} y1={560} x2={1430} y2={560} stroke={T.borderStrong} strokeWidth={2} opacity={contractIn} />
        {MRS.map(
          (mr, i) =>
            sec > mr.mergeAt && (
              <FlowDot
                key={mr.label}
                x1={560}
                y1={560}
                x2={760}
                y2={560}
                t={Math.min(1, (sec - mr.mergeAt) / 0.6)}
                color={T.green}
                opacity={sec - mr.mergeAt < 0.65 ? 1 : 0}
              />
            ),
        )}
        {sec > 7.4 && (
          <FlowDot x1={1310} y1={560} x2={1430} y2={560} t={Math.min(1, (sec - 7.4) / 0.5)} color={T.yellow} opacity={sec < 8 ? 1 : 0} />
        )}
      </svg>

      {/* GitLab MRs */}
      <Card x={120} y={430} w={440} enter={gitlabIn} color={T.orange} title="GitLab" sub="the dispatched project">
        <div style={{ marginTop: 14 }}>
          {MRS.map((mr) => {
            const merged = prog(frame, fps, mr.mergeAt, 0.4);
            return (
              <div
                key={mr.label}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "10px 16px",
                  borderRadius: 8,
                  border: `0.5px solid ${merged ? T.green : T.border}`,
                  background: merged ? `${T.green}14` : T.bgSecondary,
                  marginBottom: 8,
                  fontFamily: T.mono,
                  fontSize: 17,
                }}
              >
                <span>{mr.label}</span>
                <span style={{ color: merged ? T.green : T.textQuaternary, fontWeight: 600 }}>
                  {merged ? "✓ merged" : "open"}
                </span>
              </div>
            );
          })}
        </div>
      </Card>

      {/* tester checklist */}
      <Card x={760} y={400} w={550} enter={checklistIn} color={T.yellow} title="Tester · acceptance checklist" sub="deterministic state — merge events flip it">
        <div style={{ marginTop: 14 }}>
          {CHECKS.map((c) => {
            const ready = prog(frame, fps, c.readyAt, 0.4);
            return (
              <div
                key={c.label}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "10px 16px",
                  borderRadius: 8,
                  border: `0.5px solid ${ready ? T.yellow : T.border}`,
                  background: ready ? `${T.yellow}10` : T.bgSecondary,
                  marginBottom: 8,
                  fontSize: 18,
                }}
              >
                <span
                  style={{
                    width: 12,
                    height: 12,
                    borderRadius: "50%",
                    background: ready ? T.yellow : T.textQuaternary,
                    boxShadow: ready ? `0 0 ${pulse(frame, fps, c.readyAt, 0.8) * 16}px ${T.yellow}` : "none",
                  }}
                />
                {c.label}
                <span style={{ marginLeft: "auto", fontSize: 15, color: ready ? T.yellow : T.textQuaternary, fontWeight: 600 }}>
                  {ready ? "ready" : "awaiting merge"}
                </span>
              </div>
            );
          })}
          <div
            style={{
              marginTop: 10,
              padding: "9px 16px",
              borderRadius: 9999,
              display: "inline-block",
              border: `1px solid ${T.green}`,
              background: `${T.green}1A`,
              fontSize: 17,
              fontWeight: 600,
              opacity: verdict,
              transform: `translateY(${(1 - verdict) * 10}px)`,
            }}
          >
            ✓ verdict: pass — recorded by the human tester
          </div>
        </div>
      </Card>

      {/* interface contract */}
      <Card x={1430} y={430} w={380} enter={contractIn} color={T.cyan} title="Interface Contract" sub="backend ↔ frontend">
        <div style={{ marginTop: 12, fontFamily: T.mono, fontSize: 16, color: T.textSecondary }}>
          POST /api/payments
          <br />
          schema: PaymentIntent
        </div>
        <div
          style={{
            marginTop: 12,
            display: "inline-block",
            padding: "7px 16px",
            borderRadius: 9999,
            border: `1px solid ${T.green}`,
            background: `${T.green}1A`,
            fontSize: 16,
            fontWeight: 600,
            opacity: contractOk,
          }}
        >
          ✓ verified against what merged
        </div>
      </Card>
    </AbsoluteFill>
  );
};
