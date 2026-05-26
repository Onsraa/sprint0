import { useEffect, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { useApp } from "../app/AppContext";
import { Mascot } from "../components/Mascot";

/* sprint0 app — Hire Wizard: CV → parsed skills → Passport draft → first issues.
   Self-contained: tierFor / TierBadge / SkillRadar inlined from the dev-mode
   views so this file does not depend on other wizard files. */

const HIRE_STEPS: { id: string; label: string }[] = [
  { id: "cv", label: "CV" },
  { id: "parse", label: "Skills" },
  { id: "passport", label: "Passport" },
  { id: "starter", label: "Starter tasks" },
];

interface HireData {
  file: string | null;
  name: string;
  role: string;
  trust: number;
}

export function WizardHire() {
  const { setWizardOpen } = useApp();
  const [step, setStep] = useState(0);
  const [data, setData] = useState<HireData>({ file: null, name: "Nia Patel", role: "Frontend dev", trust: 22 });

  const close = () => setWizardOpen(false);
  const next = () => setStep((s) => Math.min(s + 1, HIRE_STEPS.length - 1));
  const prev = () => setStep((s) => Math.max(s - 1, 0));

  return (
    <div
      onClick={close}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(26,20,16,0.5)",
        backdropFilter: "blur(6px)",
        zIndex: 100,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        animation: "pop-in 240ms",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: 980,
          height: "calc(100vh - 48px)",
          maxHeight: 760,
          background: "var(--cream)",
          borderRadius: 24,
          border: "2px solid var(--ink)",
          boxShadow: "10px 10px 0 var(--ink)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: "18px 24px",
            borderBottom: "1.5px solid var(--line)",
            background: "var(--paper)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <Mascot size={36} expression={step === 3 ? "cheer" : "happy"} />
            <div>
              <div className="kicker">Onboard a developer</div>
              <div style={{ fontWeight: 800, fontSize: 16 }}>Cold-start passport</div>
            </div>
          </div>
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            {HIRE_STEPS.map((s, i) => (
              <button
                key={s.id}
                onClick={() => i <= step && setStep(i)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "6px 12px",
                  borderRadius: 999,
                  background: i === step ? "var(--info)" : i < step ? "rgba(42,111,219,0.15)" : "transparent",
                  color: i === step ? "var(--paper)" : i < step ? "var(--info)" : "var(--ink-mute)",
                  fontWeight: 700,
                  fontSize: 13,
                  opacity: i > step ? 0.5 : 1,
                  cursor: i <= step ? "pointer" : "default",
                  transition: "all 200ms",
                }}
              >
                <span
                  style={{
                    width: 20,
                    height: 20,
                    borderRadius: "50%",
                    background: i === step ? "var(--paper)" : i < step ? "var(--info)" : "var(--cream-deep)",
                    color: i === step ? "var(--info)" : "var(--paper)",
                    display: "grid",
                    placeItems: "center",
                    fontSize: 11,
                    fontWeight: 800,
                  }}
                >
                  {i < step ? "✓" : i + 1}
                </span>
                {s.label}
              </button>
            ))}
          </div>
          <button
            onClick={close}
            style={{
              width: 32,
              height: 32,
              borderRadius: 8,
              background: "var(--cream-deep)",
              display: "grid",
              placeItems: "center",
              fontSize: 18,
              fontWeight: 700,
            }}
          >
            ×
          </button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflow: "auto", padding: 32 }}>
          {step === 0 && <HireStepCV data={data} setData={setData} next={next} />}
          {step === 1 && <HireStepParse />}
          {step === 2 && <HireStepPassport />}
          {step === 3 && <HireStepStarter />}
        </div>

        {/* Footer */}
        <div
          style={{
            padding: "16px 24px",
            borderTop: "1.5px solid var(--line)",
            background: "var(--paper)",
            display: "flex",
            justifyContent: "space-between",
          }}
        >
          <button onClick={prev} disabled={step === 0} className="btn btn-ghost btn-sm" style={{ opacity: step === 0 ? 0.4 : 1 }}>
            ← Back
          </button>
          {step < HIRE_STEPS.length - 1 ? (
            <button
              onClick={next}
              disabled={step === 0 && !data.file}
              className="btn btn-sm"
              style={{
                background: "var(--info)",
                color: "var(--paper)",
                borderColor: "var(--info)",
                padding: "9px 16px",
                fontSize: 13,
                fontWeight: 700,
                borderRadius: 999,
                border: "2px solid var(--info)",
              }}
            >
              Continue →
            </button>
          ) : (
            <button onClick={close} className="btn btn-sm btn-primary">
              Add to team →
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

interface StepCVProps {
  data: HireData;
  setData: Dispatch<SetStateAction<HireData>>;
  next: () => void;
}

function HireStepCV({ data, setData, next }: StepCVProps) {
  const [drag, setDrag] = useState(false);
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 24, minHeight: 480 }}>
      <div style={{ textAlign: "center" }}>
        <div className="display" style={{ fontSize: 40, marginBottom: 8 }}>
          Drop their CV.
        </div>
        <div style={{ fontSize: 15, color: "var(--ink-soft)" }}>I'll read it, extract skills, and start a passport.</div>
      </div>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          setData({ ...data, file: "nia-patel-resume.pdf" });
        }}
        style={{
          width: "100%",
          maxWidth: 540,
          border: `3px dashed ${drag ? "var(--info)" : data.file ? "var(--positive)" : "var(--ink-faint)"}`,
          borderRadius: 24,
          padding: 40,
          background: drag ? "rgba(42,111,219,0.08)" : data.file ? "rgba(47,138,78,0.06)" : "var(--paper)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 14,
          transition: "all 200ms",
        }}
      >
        {data.file ? (
          <>
            <div
              className="float"
              style={{
                width: 80,
                height: 100,
                background: "var(--paper)",
                border: "2px solid var(--ink)",
                borderRadius: 10,
                boxShadow: "4px 4px 0 var(--ink)",
                transform: "rotate(-4deg)",
                display: "flex",
                flexDirection: "column",
                padding: 10,
                gap: 4,
              }}
            >
              <div style={{ height: 4, background: "var(--line-strong)", borderRadius: 2 }} />
              <div style={{ height: 4, background: "var(--line-strong)", borderRadius: 2, width: "70%" }} />
              <div style={{ height: 4, background: "var(--line-strong)", borderRadius: 2, width: "90%" }} />
              <div style={{ marginTop: "auto", fontSize: 8, fontWeight: 700, color: "var(--info)" }}>CV</div>
            </div>
            <div style={{ fontWeight: 700, fontSize: 16 }}>{data.file}</div>
            <button
              onClick={next}
              className="btn"
              style={{ background: "var(--info)", color: "var(--paper)", borderColor: "var(--info)", boxShadow: "0 4px 0 var(--ink)" }}
            >
              Parse skills →
            </button>
          </>
        ) : (
          <>
            <div style={{ fontSize: 40, color: "var(--ink-mute)" }}>📄</div>
            <div style={{ fontWeight: 700, fontSize: 18 }}>Drop the CV here</div>
            <div style={{ color: "var(--ink-mute)", fontSize: 13 }}>PDF · DOCX · LinkedIn export</div>
            <button onClick={() => setData({ ...data, file: "nia-patel-resume.pdf" })} className="btn btn-ghost btn-sm" style={{ marginTop: 12 }}>
              or use the demo CV
            </button>
          </>
        )}
      </div>
    </div>
  );
}

interface Fact {
  k: string;
  v: string;
}

interface Score {
  k: string;
  v: number;
  src: string;
}

function HireStepParse() {
  const facts: Fact[] = [
    { k: "name", v: "Nia Patel" },
    { k: "role-claim", v: "Frontend dev · 4 years" },
    { k: "primary", v: "React · TypeScript · Tailwind" },
    { k: "shipped", v: "3 e-commerce sites, 1 SaaS dashboard" },
    { k: "signal", v: "Open source: contributed to Radix UI" },
    { k: "gap", v: "No backend, no DB exposure on CV" },
  ];
  const scoring: Score[] = [
    { k: "Frontend", v: 68, src: "strong CV signal" },
    { k: "Backend", v: 12, src: "no evidence yet" },
    { k: "Data / DB", v: 8, src: "no evidence yet" },
    { k: "DevOps", v: 18, src: "minor mention" },
    { k: "Product", v: 35, src: "shipped products" },
    { k: "Velocity", v: 50, src: "baseline" },
  ];
  const [shown, setShown] = useState(0);
  useEffect(() => {
    if (shown < facts.length) {
      const t = setTimeout(() => setShown((s) => s + 1), 280);
      return () => clearTimeout(t);
    }
  }, [shown]);

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 32, height: "100%" }}>
      <div>
        <div className="kicker">Extracted from CV</div>
        <div className="display" style={{ fontSize: 26, marginTop: 6, marginBottom: 18 }}>
          What Zero read.
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {facts.map(
            (f, i) =>
              i < shown && (
                <div
                  key={i}
                  className="card-soft"
                  style={{ padding: "10px 14px", display: "flex", alignItems: "flex-start", gap: 12, background: "var(--paper)", animation: "pop-in 300ms both" }}
                >
                  <div
                    className="mono"
                    style={{ fontSize: 10, color: f.k === "gap" ? "var(--warn)" : "var(--info)", fontWeight: 800, textTransform: "uppercase", minWidth: 70 }}
                  >
                    {f.k}
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 600, flex: 1 }}>{f.v}</div>
                  <div style={{ color: f.k === "gap" ? "var(--warn)" : "var(--positive)" }}>{f.k === "gap" ? "?" : "✓"}</div>
                </div>
              ),
          )}
        </div>
      </div>
      <div>
        <div className="kicker">Initial scoring</div>
        <div className="display" style={{ fontSize: 26, marginTop: 6, marginBottom: 18 }}>
          Baseline skills.
        </div>
        <div className="card-soft" style={{ padding: 18 }}>
          {scoring.map((s, i) => (
            <div key={s.k} style={{ marginBottom: 10, animation: `pop-in 350ms ${i * 0.08}s both` }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 4 }}>
                <span style={{ fontWeight: 700 }}>{s.k}</span>
                <span style={{ color: "var(--ink-mute)", fontFamily: "var(--font-mono)" }}>
                  {s.v} · <span style={{ fontStyle: "italic", color: "var(--ink-faint)" }}>{s.src}</span>
                </span>
              </div>
              <div style={{ height: 6, background: "var(--cream-deep)", borderRadius: 999, overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${s.v}%`, background: s.v >= 50 ? "var(--info)" : "#bbb", transition: "width 400ms" }} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function HireStepPassport() {
  const skills: Skill[] = [
    { k: "Frontend", v: 68 },
    { k: "Backend", v: 12 },
    { k: "Data / DB", v: 8 },
    { k: "DevOps", v: 18 },
    { k: "Product", v: 35 },
    { k: "Velocity", v: 50 },
  ];
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 32, alignItems: "start" }}>
      <div>
        <div className="kicker">Generated</div>
        <div className="display" style={{ fontSize: 26, marginTop: 6, marginBottom: 8 }}>
          Nia's passport.
        </div>
        <div style={{ fontSize: 14, color: "var(--ink-soft)", marginBottom: 16 }}>
          Stored in MongoDB. Updates with every merge. Starts at <b style={{ color: "var(--ink)" }}>Apprentice (22)</b>.
        </div>

        <div className="card-soft" style={{ padding: 18, marginBottom: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
            <div
              style={{
                width: 56,
                height: 56,
                borderRadius: "50%",
                background: "#888",
                color: "var(--paper)",
                border: "2px solid var(--ink)",
                display: "grid",
                placeItems: "center",
                fontWeight: 800,
                fontSize: 18,
              }}
            >
              NP
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700, fontSize: 18 }}>Nia Patel</div>
              <div style={{ fontSize: 12, color: "var(--ink-mute)" }}>Frontend dev · joined just now</div>
            </div>
            <TierBadge devTrust={22} />
          </div>
          <div style={{ padding: 12, background: "var(--cream)", borderRadius: 10, fontSize: 12, color: "var(--ink-soft)", lineHeight: 1.5 }}>
            <b>Apprentice rules:</b> low-risk issues only · always micro-contexted · mentor required on architecture decisions.
          </div>
        </div>
      </div>

      <div className="card-soft" style={{ padding: 18 }}>
        <div className="kicker" style={{ marginBottom: 6 }}>
          Skill vector
        </div>
        <SkillRadar skills={skills} />
      </div>
    </div>
  );
}

interface Task {
  id: string;
  t: string;
  repo: string;
  est: string;
  risk: string;
  reason: string;
}

function HireStepStarter() {
  const tasks: Task[] = [
    { id: "#231", t: "Update privacy page copy", repo: "luxe-real-estate", est: "45m", risk: "low", reason: "Pure copy. No logic. Safe first ship." },
    { id: "#232", t: "Add aria-labels to nav buttons", repo: "luxe-real-estate", est: "1h", risk: "low", reason: "Accessibility. Pattern reusable." },
    { id: "#233", t: "Theme dark-mode polish on cards", repo: "courier-track", est: "2h", risk: "low", reason: "Visible win. Builds confidence." },
  ];
  return (
    <div>
      <div className="kicker">Starter pack</div>
      <div className="display" style={{ fontSize: 26, marginTop: 6, marginBottom: 6 }}>
        3 issues, hand-picked.
      </div>
      <p style={{ fontSize: 14, color: "var(--ink-soft)", margin: "0 0 18px", maxWidth: 600 }}>
        Low-risk, micro-contexted, visible wins. Each merge adds trust. Promotion at 35.
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {tasks.map((t, i) => (
          <div key={t.id} className="card-soft card-hover" style={{ padding: 16, animation: `pop-in 350ms ${i * 0.1}s both` }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
              <div className="mono" style={{ fontSize: 12, color: "var(--ink-mute)" }}>
                {t.id} · {t.repo}
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                <span className="chip" style={{ fontSize: 10, padding: "2px 8px" }}>
                  est {t.est}
                </span>
                <span
                  className="chip"
                  style={{ fontSize: 10, padding: "2px 8px", background: "var(--orange-soft)", borderColor: "var(--orange)", color: "var(--orange-deep)" }}
                >
                  {t.risk} risk
                </span>
              </div>
            </div>
            <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 6 }}>{t.t}</div>
            <div style={{ fontSize: 12, color: "var(--ink-soft)", display: "flex", alignItems: "center", gap: 6 }}>
              <Mascot size={20} expression="happy" />
              <span>
                <b>why:</b> {t.reason}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Inlined from dev-mode views (app-dev.jsx) ── */

interface Tier {
  t: string;
  c: string;
  ring: string;
  desc: string;
}

function tierFor(t: number): Tier {
  if (t < 35) return { t: "Apprentice", c: "#888", ring: "#bbb", desc: "Low-risk issues. Micro-contexted." };
  if (t < 75) return { t: "Trusted", c: "var(--info)", ring: "#7AA5E8", desc: "Mid-risk features. Mentored on architecture." };
  return { t: "Senior", c: "var(--positive)", ring: "#7BC79A", desc: "Full repo access. Reviews juniors." };
}

function TierBadge({ devTrust }: { devTrust: number }) {
  const tier = tierFor(devTrust);
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "8px 14px",
        borderRadius: 999,
        background: tier.c,
        color: "var(--paper)",
        border: "2px solid var(--ink)",
        boxShadow: "0 3px 0 var(--ink)",
      }}
    >
      <span style={{ fontSize: 16 }}>★</span>
      <div style={{ lineHeight: 1.1 }}>
        <div style={{ fontSize: 14, fontWeight: 800 }}>{tier.t}</div>
        <div className="mono" style={{ fontSize: 10, opacity: 0.85 }}>
          trust · {devTrust}/100
        </div>
      </div>
    </div>
  );
}

interface Skill {
  k: string;
  v: number;
}

function SkillRadar({ skills }: { skills: Skill[] }) {
  // hex radar; map 6 axes
  const cx = 200,
    cy = 200,
    R = 150;
  const n = skills.length;
  const angle = (i: number) => -Math.PI / 2 + (i * 2 * Math.PI) / n;
  const pt = (i: number, r: number): [number, number] => [cx + Math.cos(angle(i)) * r, cy + Math.sin(angle(i)) * r];

  const rings = [0.25, 0.5, 0.75, 1].map((f) => {
    return Array.from({ length: n }, (_, i) => pt(i, R * f).join(",")).join(" ");
  });
  const skillPoly = skills.map((s, i) => pt(i, (R * s.v) / 100).join(",")).join(" ");

  return (
    <div style={{ display: "flex", justifyContent: "center", padding: 8 }}>
      <svg viewBox="0 0 400 400" width="380" height="380">
        {/* rings */}
        {rings.map((r, i) => (
          <polygon key={i} points={r} fill="none" stroke="var(--line-strong)" strokeWidth={i === rings.length - 1 ? 2 : 1} />
        ))}
        {/* axes */}
        {skills.map((s, i) => {
          const [x, y] = pt(i, R);
          return <line key={s.k} x1={cx} y1={cy} x2={x} y2={y} stroke="var(--line-strong)" strokeWidth="1" />;
        })}
        {/* skill area */}
        <polygon points={skillPoly} fill="var(--orange)" fillOpacity="0.25" stroke="var(--orange)" strokeWidth="3" strokeLinejoin="round" />
        {/* skill dots */}
        {skills.map((s, i) => {
          const [x, y] = pt(i, (R * s.v) / 100);
          return <circle key={s.k} cx={x} cy={y} r="5" fill="var(--orange)" stroke="var(--paper)" strokeWidth="2" />;
        })}
        {/* labels */}
        {skills.map((s, i) => {
          const [x, y] = pt(i, R + 26);
          return (
            <text key={s.k} x={x} y={y} textAnchor="middle" dominantBaseline="middle" fontFamily="var(--font-display)" fontSize="14" fontWeight="700" fill="var(--ink)">
              {s.k}
            </text>
          );
        })}
        {/* center label */}
        <text x={cx} y={cy - 4} textAnchor="middle" fontFamily="var(--font-display)" fontSize="24" fontWeight="800" fill="var(--orange)">
          {Math.round(skills.reduce((a, s) => a + s.v, 0) / skills.length)}
        </text>
        <text x={cx} y={cy + 14} textAnchor="middle" fontFamily="var(--font-mono)" fontSize="10" fill="var(--ink-mute)">
          AVG
        </text>
      </svg>
    </div>
  );
}
