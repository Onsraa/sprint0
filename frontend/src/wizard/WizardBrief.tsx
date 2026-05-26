import { useEffect, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { useApp } from "../app/AppContext";
import { Mascot } from "../components/Mascot";

/* sprint0 — Brief Wizard (Drop → Parse → Plan → Devs → Trust → Ship)
   Self-contained port of the BRIEF flow from app-wizard.jsx. */

interface Brief {
  name: string;
  client: string;
  goal: string;
  deadline: string;
  stack: string[];
}

interface MemoryMatch {
  n: string;
  pct: number;
  devs: string[];
  color: string;
}

interface BriefData {
  file: string | null;
  brief: Brief;
  parsed: boolean;
  match: MemoryMatch | null;
  plan: unknown;
  devs: unknown;
  trust: number;
  shipping: boolean;
}

type SetData = Dispatch<SetStateAction<BriefData>>;

const STEPS = [
  { id: "drop", label: "Brief" },
  { id: "parse", label: "Read" },
  { id: "plan", label: "Plan" },
  { id: "devs", label: "Assign" },
  { id: "trust", label: "Trust" },
  { id: "ship", label: "Ship" },
];

export function WizardBrief() {
  const { setWizardOpen } = useApp();
  const [step, setStep] = useState(0);
  const [data, setData] = useState<BriefData>({
    file: null,
    brief: { name: "", client: "", goal: "", deadline: "", stack: [] },
    parsed: false,
    match: null,
    plan: null,
    devs: null,
    trust: 70,
    shipping: false,
  });

  const close = () => setWizardOpen(false);
  const next = () => setStep((s) => Math.min(s + 1, STEPS.length - 1));
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
          maxWidth: 1100,
          height: "calc(100vh - 48px)",
          maxHeight: 820,
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
            <Mascot size={36} expression={step === 1 ? "focused" : step === 5 ? "cheer" : "happy"} />
            <div>
              <div className="kicker">New Sprint 0</div>
              <div style={{ fontWeight: 800, fontSize: 16 }}>Zero is on it</div>
            </div>
          </div>
          {/* progress dots */}
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            {STEPS.map((s, i) => (
              <button
                key={s.id}
                onClick={() => i <= step && setStep(i)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "6px 12px",
                  borderRadius: 999,
                  background: i === step ? "var(--orange)" : i < step ? "var(--orange-soft)" : "transparent",
                  color: i === step ? "var(--paper)" : i < step ? "var(--orange-deep)" : "var(--ink-mute)",
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
                    background: i === step ? "var(--paper)" : i < step ? "var(--orange)" : "var(--cream-deep)",
                    color: i === step ? "var(--orange)" : "var(--paper)",
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
        <div style={{ flex: 1, overflow: "auto", padding: 32, display: "flex", flexDirection: "column" }}>
          {step === 0 && <StepDrop data={data} setData={setData} next={next} />}
          {step === 1 && <StepParse data={data} setData={setData} />}
          {step === 2 && <StepPlan />}
          {step === 3 && <StepDevs />}
          {step === 4 && <StepTrust data={data} setData={setData} />}
          {step === 5 && (
            <StepShip
              data={data}
              onDone={() => {
                setTimeout(() => {
                  close();
                }, 800);
              }}
            />
          )}
        </div>

        {/* Footer nav */}
        {step !== 5 && (
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
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <button onClick={close} className="btn btn-ghost btn-sm">
                Save & exit
              </button>
              <button onClick={next} className="btn btn-primary btn-sm" disabled={step === 0 && !data.file}>
                {step === 4 ? "Launch" : "Continue"} →
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ============================================================
   STEP 0 — DROP
   ============================================================ */
interface SampleFile {
  name: string;
  size: string;
  color: string;
}

function StepDrop({ data, setData, next }: { data: BriefData; setData: SetData; next: () => void }) {
  const [drag, setDrag] = useState(false);

  const samples: SampleFile[] = [
    { name: "real-estate-listings.pdf", size: "1.2 MB", color: "#0F8E5C" },
    { name: "fintech-spec.notion", size: "12 pages", color: "#2A6FDB" },
    { name: "client-loom-recording", size: "12 min", color: "#D97706" },
  ];

  const pick = (s: SampleFile) =>
    setData({
      ...data,
      file: s.name,
      brief: { ...data.brief, name: s.name.split(".")[0].replace(/-/g, "-") },
    });

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 24 }}>
      <div style={{ textAlign: "center" }}>
        <div className="display" style={{ fontSize: 44, marginBottom: 10 }}>
          Drop the brief.
        </div>
        <div style={{ fontSize: 16, color: "var(--ink-soft)" }}>PDF · Notion link · Loom · email · voice memo. Whatever you got.</div>
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
          pick(samples[0]);
        }}
        style={{
          width: "100%",
          maxWidth: 640,
          border: `3px dashed ${drag ? "var(--orange)" : data.file ? "var(--positive)" : "var(--ink-faint)"}`,
          borderRadius: 24,
          padding: 40,
          background: drag ? "var(--orange-tint)" : data.file ? "rgba(47,138,78,0.06)" : "var(--paper)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 16,
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
              <div style={{ marginTop: "auto", fontSize: 8, fontWeight: 700, color: "var(--orange)" }}>brief</div>
            </div>
            <div style={{ fontWeight: 700, fontSize: 18 }}>{data.file}</div>
            <div style={{ display: "flex", gap: 8, alignItems: "center", color: "var(--positive)", fontSize: 13, fontWeight: 700 }}>
              <span style={{ width: 10, height: 10, borderRadius: "50%", background: "var(--positive)" }} /> ready to parse
            </div>
            <button onClick={next} className="btn btn-primary">
              Read it →
            </button>
          </>
        ) : (
          <>
            <div style={{ fontSize: 40, color: "var(--ink-mute)" }}>⬇</div>
            <div style={{ fontWeight: 700, fontSize: 18 }}>Drag a file here</div>
            <div style={{ color: "var(--ink-mute)", fontSize: 13 }}>or pick a sample below</div>
          </>
        )}
      </div>

      {!data.file && (
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", justifyContent: "center" }}>
          {samples.map((s) => (
            <button
              key={s.name}
              onClick={() => pick(s)}
              className="card-soft card-hover"
              style={{ padding: 14, display: "flex", alignItems: "center", gap: 10, background: "var(--paper)", cursor: "pointer" }}
            >
              <div style={{ width: 32, height: 32, borderRadius: 8, background: s.color, border: "1.5px solid var(--ink)" }} />
              <div style={{ textAlign: "left" }}>
                <div style={{ fontWeight: 700, fontSize: 13 }}>{s.name}</div>
                <div style={{ fontSize: 11, color: "var(--ink-mute)" }}>{s.size}</div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ============================================================
   STEP 1 — PARSE & match memory
   ============================================================ */
interface Fact {
  k: string;
  v: string;
}

function StepParse({ data, setData }: { data: BriefData; setData: SetData }) {
  const facts: Fact[] = [
    { k: "goal", v: "Real-estate listings + agent CRM" },
    { k: "stack", v: "Next.js · Postgres · Stripe" },
    { k: "deadline", v: "8 weeks" },
    { k: "constraint", v: "iPad-friendly for field agents" },
    { k: "users", v: "~200 agents · 50k listings" },
  ];
  const matches: MemoryMatch[] = [
    { n: "zillow-clone-2024", pct: 92, devs: ["MR", "TS", "KB"], color: "#0F8E5C" },
    { n: "redfin-tools-2025", pct: 78, devs: ["MR", "JL"], color: "#2A6FDB" },
    { n: "propspot-mvp-2025", pct: 71, devs: ["KB", "AS"], color: "#D97706" },
  ];
  const [shown, setShown] = useState(0);
  useEffect(() => {
    if (shown < facts.length + matches.length) {
      const t = setTimeout(() => setShown((s) => s + 1), 280);
      return () => clearTimeout(t);
    } else if (!data.match) {
      setData({ ...data, parsed: true, match: matches[0] });
    }
  }, [shown]);

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 32, height: "100%" }}>
      <div>
        <div className="kicker">Extracted facts</div>
        <div className="display" style={{ fontSize: 28, margin: "6px 0 20px" }}>
          What Zero read.
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {facts.map(
            (f, i) =>
              i < shown && (
                <div
                  key={i}
                  className="card-soft"
                  style={{
                    padding: "10px 14px",
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    background: "var(--paper)",
                    animation: "pop-in 300ms both",
                  }}
                >
                  <div
                    className="mono"
                    style={{ fontSize: 10, color: "var(--orange)", fontWeight: 800, textTransform: "uppercase", minWidth: 70 }}
                  >
                    {f.k}
                  </div>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>{f.v}</div>
                  <div style={{ marginLeft: "auto", color: "var(--positive)" }}>✓</div>
                </div>
              ),
          )}
          {shown < facts.length && <ParseLoading />}
        </div>
      </div>
      <div>
        <div className="kicker">Memory match</div>
        <div className="display" style={{ fontSize: 28, margin: "6px 0 20px" }}>
          Closest twins.
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {matches.map(
            (m, i) =>
              shown - facts.length > i && (
                <div
                  key={m.n}
                  className="card-soft card-hover"
                  style={{
                    padding: 14,
                    cursor: "pointer",
                    border: data.match?.n === m.n ? "2px solid var(--orange)" : "1.5px solid var(--line-strong)",
                    background: data.match?.n === m.n ? "var(--orange-tint)" : "var(--paper)",
                    animation: "pop-in 300ms both",
                  }}
                  onClick={() => setData({ ...data, match: m })}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div className="mono" style={{ fontWeight: 700, fontSize: 14 }}>
                      {m.n}
                    </div>
                    <div className="display" style={{ fontSize: 24, color: m.pct >= 80 ? "var(--orange)" : "var(--ink-soft)" }}>
                      {m.pct}%
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 6, marginTop: 8, alignItems: "center", fontSize: 12, color: "var(--ink-mute)" }}>
                    <span>reusable:</span>
                    <span className="chip" style={{ fontSize: 10, padding: "2px 7px" }}>
                      auth
                    </span>
                    <span className="chip" style={{ fontSize: 10, padding: "2px 7px" }}>
                      map-view
                    </span>
                    <span className="chip" style={{ fontSize: 10, padding: "2px 7px" }}>
                      +{Math.floor(m.pct / 15)} more
                    </span>
                  </div>
                </div>
              ),
          )}
        </div>
      </div>
    </div>
  );
}

function ParseLoading() {
  return (
    <div
      style={{
        padding: "10px 14px",
        display: "flex",
        alignItems: "center",
        gap: 12,
        background: "var(--cream-deep)",
        borderRadius: 12,
        border: "1.5px dashed var(--line-strong)",
        fontFamily: "var(--font-mono)",
        fontSize: 12,
        color: "var(--ink-mute)",
      }}
    >
      <div
        style={{
          width: 14,
          height: 14,
          borderRadius: "50%",
          border: "2px solid var(--orange)",
          borderTopColor: "transparent",
          animation: "spin-slow 0.8s linear infinite",
        }}
      />
      gemini-2.5-flash · reading...
    </div>
  );
}

/* ============================================================
   STEP 2 — PLAN (kanban with epics)
   ============================================================ */
interface Epic {
  id: string;
  t: string;
  est: number;
  src: string;
  spo?: number;
}

type ColId = "backlog" | "sprint1" | "later";
type Cols = Record<ColId, Epic[]>;

function StepPlan() {
  const initial: Cols = {
    backlog: [
      { id: "e1", t: "Auth + onboarding", est: 3, src: "zillow-clone", spo: 2 },
      { id: "e2", t: "Listings DB + search", est: 5, src: "zillow-clone", spo: 8 },
      { id: "e3", t: "Map view (iPad)", est: 4, src: "redfin-tools", spo: 6 },
      { id: "e4", t: "Agent CRM", est: 4, src: "agent-crm-v2", spo: 5 },
    ],
    sprint1: [
      { id: "e5", t: "Project scaffold", est: 1, src: "all projects", spo: 1 },
      { id: "e6", t: "Stripe payments", est: 3, src: "fintech-jr", spo: 4 },
      { id: "e7", t: "Photo uploads + CDN", est: 2, src: "zillow-clone", spo: 3 },
    ],
    later: [
      { id: "e8", t: "Notifications", est: 2, src: "new" },
      { id: "e9", t: "Admin dashboard", est: 3, src: "new" },
    ],
  };
  const [cols, setCols] = useState<Cols>(initial);
  const [dragId, setDragId] = useState<string | null>(null);

  const move = (taskId: string, fromCol: ColId, toCol: ColId) => {
    setCols((c) => {
      const task = c[fromCol].find((x) => x.id === taskId);
      if (!task) return c;
      return {
        ...c,
        [fromCol]: c[fromCol].filter((x) => x.id !== taskId),
        [toCol]: [...c[toCol], task],
      };
    });
  };

  const colNames: Record<ColId, string> = { backlog: "Backlog", sprint1: "Sprint 1", later: "Later" };

  return (
    <div>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 18 }}>
        <div>
          <div className="kicker">Generated plan</div>
          <div className="display" style={{ fontSize: 28, marginTop: 4 }}>
            6 epics. 32 issues. Drag to adjust.
          </div>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <span className="chip">Show issues</span>
          <span className="chip chip-orange">Kanban</span>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, minHeight: 360 }}>
        {(Object.entries(cols) as [ColId, Epic[]][]).map(([colId, tasks]) => (
          <div
            key={colId}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              if (dragId) {
                const fromCol = (Object.entries(cols) as [ColId, Epic[]][]).find(([, ts]) => ts.find((t) => t.id === dragId))?.[0];
                if (fromCol && fromCol !== colId) move(dragId, fromCol, colId);
                setDragId(null);
              }
            }}
            style={{
              background: colId === "sprint1" ? "var(--orange-tint)" : "var(--paper)",
              border: colId === "sprint1" ? "2px solid var(--orange)" : "1.5px solid var(--line-strong)",
              borderRadius: 16,
              padding: 14,
              minHeight: 360,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <div
                className="mono"
                style={{
                  fontSize: 11,
                  fontWeight: 800,
                  color: colId === "sprint1" ? "var(--orange-deep)" : "var(--ink-mute)",
                  textTransform: "uppercase",
                }}
              >
                {colNames[colId]}
              </div>
              <div
                style={{
                  background: "var(--paper)",
                  padding: "2px 8px",
                  borderRadius: 999,
                  fontSize: 11,
                  fontWeight: 700,
                  color: "var(--ink-soft)",
                  border: "1px solid var(--line-strong)",
                }}
              >
                {tasks.length}
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {tasks.map((t) => (
                <div
                  key={t.id}
                  draggable
                  onDragStart={() => setDragId(t.id)}
                  className="card-soft card-hover"
                  style={{
                    padding: 12,
                    background: "var(--paper)",
                    cursor: "grab",
                    borderColor: dragId === t.id ? "var(--orange)" : "var(--line-strong)",
                  }}
                >
                  <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6 }}>{t.t}</div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11 }}>
                    <span style={{ padding: "2px 6px", borderRadius: 4, background: "var(--cream-deep)", fontWeight: 700, color: "var(--ink-soft)" }}>
                      {t.est}d
                    </span>
                    {t.spo && <span style={{ color: "var(--ink-mute)" }}>{t.spo} issues</span>}
                    <span
                      style={{ marginLeft: "auto", color: "var(--positive)", fontFamily: "var(--font-mono)", fontSize: 10 }}
                      title={`reused from ${t.src}`}
                    >
                      ↻ {t.src}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div
        style={{
          marginTop: 14,
          padding: 12,
          background: "var(--paper)",
          borderRadius: 12,
          border: "1.5px dashed var(--line-strong)",
          display: "flex",
          alignItems: "center",
          gap: 10,
          fontSize: 13,
          color: "var(--ink-soft)",
        }}
      >
        <Mascot size={28} expression="happy" />
        <span>
          <b>Zero says:</b> Drag epics between sprints. I'll regenerate issue lists on the fly.
        </span>
      </div>
    </div>
  );
}

/* ============================================================
   STEP 3 — DEV MATCH
   ============================================================ */
interface Dev {
  i: string;
  n: string;
  role: string;
  load: number;
  shipped: string[];
  match: number;
  assigned: string[];
}

function StepDevs() {
  const devs: Dev[] = [
    { i: "MR", n: "Maria R.", role: "FE lead", load: 60, shipped: ["zillow-clone", "redfin-tools"], match: 94, assigned: ["Auth", "Map view"] },
    { i: "TS", n: "Tomás S.", role: "FS", load: 35, shipped: ["zillow-clone", "propspot"], match: 88, assigned: ["Listings DB", "Photo CDN"] },
    { i: "KB", n: "Kira B.", role: "BE", load: 80, shipped: ["agent-crm", "propspot"], match: 74, assigned: ["Agent CRM"] },
    { i: "AS", n: "Alex S.", role: "FS", load: 25, shipped: ["fintech-jr"], match: 81, assigned: ["Stripe payments"] },
    { i: "JL", n: "Juno L.", role: "Mobile", load: 90, shipped: ["fieldforce"], match: 42, assigned: [] },
  ];

  return (
    <div>
      <div className="kicker">Dev-Match</div>
      <div className="display" style={{ fontSize: 28, marginTop: 4, marginBottom: 18 }}>
        Who's done this before. Who's free.
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 12 }}>
        {devs.map((d, i) => (
          <div key={d.i} className="card-soft card-hover" style={{ padding: 16, animation: `pop-in 300ms ${i * 0.07}s both` }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
              <div
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: "50%",
                  background: ["#F4511E", "#2A6FDB", "#0F8E5C", "#7C3AED", "#D97706"][i % 5],
                  color: "var(--paper)",
                  border: "2px solid var(--ink)",
                  display: "grid",
                  placeItems: "center",
                  fontWeight: 800,
                }}
              >
                {d.i}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: 14 }}>{d.n}</div>
                <div style={{ fontSize: 11, color: "var(--ink-mute)", fontFamily: "var(--font-mono)" }}>{d.role}</div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div className="display" style={{ fontSize: 22, color: d.match >= 70 ? "var(--positive)" : "var(--ink-faint)" }}>
                  {d.match}%
                </div>
                <div style={{ fontSize: 10, color: "var(--ink-mute)", fontWeight: 700, textTransform: "uppercase" }}>fit</div>
              </div>
            </div>

            <div style={{ marginBottom: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginBottom: 4, color: "var(--ink-mute)", fontWeight: 700 }}>
                <span>BANDWIDTH</span>
                <span>{d.load}% loaded</span>
              </div>
              <div style={{ height: 6, background: "var(--cream-deep)", borderRadius: 999, overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${d.load}%`, background: d.load > 75 ? "var(--warn)" : "var(--positive)" }} />
              </div>
            </div>

            <div style={{ fontSize: 11, color: "var(--ink-mute)", marginBottom: 6 }}>
              <b style={{ color: "var(--ink-soft)" }}>SHIPPED:</b> {d.shipped.join(" · ")}
            </div>

            {d.assigned.length > 0 ? (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 8 }}>
                {d.assigned.map((a) => (
                  <span key={a} className="chip chip-soft" style={{ fontSize: 11 }}>
                    {a}
                  </span>
                ))}
              </div>
            ) : (
              <div style={{ padding: "6px 10px", background: "var(--cream)", borderRadius: 8, fontSize: 12, color: "var(--ink-mute)", marginTop: 8 }}>
                Bench this sprint — overloaded
              </div>
            )}
          </div>
        ))}
      </div>

      <div
        style={{
          marginTop: 14,
          padding: 12,
          background: "var(--paper)",
          borderRadius: 12,
          border: "1.5px dashed var(--line-strong)",
          display: "flex",
          alignItems: "center",
          gap: 10,
          fontSize: 13,
          color: "var(--ink-soft)",
        }}
      >
        <Mascot size={28} expression="focused" />
        <span>
          <b>Zero says:</b> 4 of 5 devs matched. JL is at 90%, parking them for now.
        </span>
      </div>
    </div>
  );
}

/* ============================================================
   STEP 4 — TRUST DIAL
   ============================================================ */
function StepTrust({ data, setData }: { data: BriefData; setData: SetData }) {
  const trust = data.trust;
  const setTrust = (v: number) => setData({ ...data, trust: v });
  const mode = trust < 25 ? "Advisor" : trust < 55 ? "Co-pilot" : trust < 85 ? "Navigator" : "Autonomous";

  const summary = [
    "Create GitLab group: real-estate-app",
    "Init repo with chosen stack",
    "Open 32 issues across 6 epics",
    "Assign 4 devs per Dev-Match",
    "Commit boilerplate from zillow-clone",
    "Email Sprint Zero report to client",
  ];

  const presets: [string, number][] = [
    ["Advisor", 10],
    ["Co-pilot", 40],
    ["Navigator", 70],
    ["Autonomous", 95],
  ];

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 32, height: "100%" }}>
      <div>
        <div className="kicker">Trust dial</div>
        <div className="display" style={{ fontSize: 28, marginTop: 4, marginBottom: 24 }}>
          How much should Zero ask?
        </div>

        <div style={{ padding: 20, background: "var(--paper)", borderRadius: 16, border: "1.5px solid var(--line-strong)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 16 }}>
            <div className="mono" style={{ fontSize: 11, color: "var(--ink-mute)", fontWeight: 700 }}>
              LEVEL
            </div>
            <div className="display" style={{ fontSize: 28, color: "var(--orange)" }}>
              {trust}%
            </div>
          </div>

          <div style={{ position: "relative", padding: "12px 0" }}>
            <input
              type="range"
              min="0"
              max="100"
              value={trust}
              onChange={(e) => setTrust(parseInt(e.target.value))}
              className="trust-slider"
              style={{ width: "100%", height: 16, appearance: "none", background: "transparent", position: "relative", zIndex: 2 }}
            />
            <div
              style={{
                position: "absolute",
                left: 0,
                right: 0,
                top: "50%",
                transform: "translateY(-50%)",
                height: 16,
                borderRadius: 999,
                background: "var(--cream-deep)",
                border: "2px solid var(--ink)",
                pointerEvents: "none",
                overflow: "hidden",
              }}
            >
              <div style={{ height: "100%", width: `${trust}%`, background: "var(--orange)" }} />
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6, marginTop: 14 }}>
            {presets.map(([n, v]) => (
              <button
                key={n}
                onClick={() => setTrust(v)}
                style={{
                  padding: "8px 4px",
                  borderRadius: 8,
                  fontSize: 11,
                  fontWeight: 700,
                  background: mode === n ? "var(--orange-soft)" : "var(--cream)",
                  color: mode === n ? "var(--orange-deep)" : "var(--ink-soft)",
                  border: mode === n ? "1.5px solid var(--orange)" : "1.5px solid var(--line)",
                }}
              >
                {n}
              </button>
            ))}
          </div>

          <div style={{ marginTop: 18, padding: 14, background: "var(--cream)", borderRadius: 10, display: "flex", gap: 10, alignItems: "center" }}>
            <Mascot size={40} expression={mode === "Autonomous" ? "cheer" : mode === "Navigator" ? "working" : "happy"} />
            <div style={{ fontSize: 13 }}>
              <b>{mode}.</b>{" "}
              {trust >= 85
                ? "I'll ship without asking."
                : trust >= 55
                  ? "I'll do most things and ping you when I'm done."
                  : trust >= 25
                    ? "I'll draft, you approve each step."
                    : "I'll just suggest — you do the work."}
            </div>
          </div>
        </div>
      </div>

      <div>
        <div className="kicker">Launch plan</div>
        <div className="display" style={{ fontSize: 28, marginTop: 4, marginBottom: 24 }}>
          Ready to ship.
        </div>

        <div className="card-soft" style={{ padding: 18, background: "var(--paper)" }}>
          {summary.map((s, i) => (
            <div
              key={i}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "10px 0",
                borderBottom: i < summary.length - 1 ? "1px solid var(--line)" : "none",
              }}
            >
              <div
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: "50%",
                  background: trust >= 70 ? "var(--positive)" : "var(--warn)",
                  color: "var(--paper)",
                  display: "grid",
                  placeItems: "center",
                  fontSize: 12,
                  fontWeight: 800,
                }}
              >
                {trust >= 70 ? "✓" : "?"}
              </div>
              <div style={{ fontSize: 13, fontWeight: 600, flex: 1 }}>{s}</div>
              <div style={{ fontSize: 11, color: trust >= 70 ? "var(--positive)" : "var(--warn)", fontWeight: 700, fontFamily: "var(--font-mono)" }}>
                {trust >= 70 ? "AUTO" : "ASK"}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   STEP 5 — SHIP (live terminal stream)
   ============================================================ */
interface ShipEvent {
  t: string;
  ms: number;
}

function StepShip({ data, onDone }: { data: BriefData; onDone: () => void }) {
  void data;
  const events: ShipEvent[] = [
    { t: "connecting GitLab MCP server...", ms: 300 },
    { t: "✓ MCP handshake · gitlab-mcp · mongo-mcp", ms: 400 },
    { t: "creating group: real-estate-app", ms: 600 },
    { t: "✓ group created · gid=8842", ms: 400 },
    { t: "initializing repository: web", ms: 500 },
    { t: "✓ repo init · default branch: main", ms: 400 },
    { t: "opening 6 epics...", ms: 700 },
    { t: "✓ epic: Auth + onboarding", ms: 250 },
    { t: "✓ epic: Listings DB + search", ms: 250 },
    { t: "✓ epic: Map view (iPad)", ms: 250 },
    { t: "✓ epic: Agent CRM", ms: 250 },
    { t: "✓ epic: Project scaffold", ms: 250 },
    { t: "✓ epic: Stripe payments", ms: 250 },
    { t: "opening 32 issues with assignees...", ms: 800 },
    { t: "✓ 32 issues created · 4 devs assigned", ms: 500 },
    { t: "committing boilerplate from zillow-clone-2024@a1f4e2", ms: 700 },
    { t: "✓ commit pushed · 8,432 lines from memory", ms: 500 },
    { t: "opening MR: feat/scaffold-sprint-zero", ms: 400 },
    { t: "✓ MR open · awaiting CI", ms: 400 },
    { t: "generating Sprint 0 client report (PDF)", ms: 600 },
    { t: "✓ report generated · 4 pages", ms: 400 },
    { t: "✓ emailed luxe@properties.com", ms: 400 },
    { t: "", ms: 200 },
    { t: "→ shipped in 47s", ms: 200 },
  ];
  const [idx, setIdx] = useState(0);
  const termRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (idx < events.length) {
      const t = setTimeout(() => setIdx((i) => i + 1), events[idx].ms);
      return () => clearTimeout(t);
    } else {
      const t = setTimeout(() => onDone(), 1500);
      return () => clearTimeout(t);
    }
  }, [idx]);
  useEffect(() => {
    if (termRef.current) termRef.current.scrollTop = termRef.current.scrollHeight;
  });

  const pct = Math.min(100, Math.round((idx / events.length) * 100));
  const done = idx >= events.length;

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 18 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <div className="kicker">Scaffolding live</div>
          <div className="display" style={{ fontSize: 28, marginTop: 4 }}>
            {done ? "Sprint 0 shipped." : "Zero is working..."}
          </div>
        </div>
        <div className={done ? "" : "wiggle"} style={{ marginRight: 16 }}>
          <Mascot size={72} expression={done ? "cheer" : "working"} />
        </div>
      </div>

      <div style={{ height: 8, background: "var(--cream-deep)", borderRadius: 999, overflow: "hidden", border: "1.5px solid var(--line-strong)" }}>
        <div style={{ height: "100%", width: `${pct}%`, background: "var(--orange)", transition: "width 200ms" }} />
      </div>

      <div
        ref={termRef}
        className="mono"
        style={{
          flex: 1,
          background: "var(--ink)",
          color: "var(--paper)",
          borderRadius: 14,
          padding: 18,
          overflow: "auto",
          fontSize: 13,
          lineHeight: 1.6,
          border: "2px solid var(--ink)",
          boxShadow: "4px 4px 0 var(--orange)",
        }}
      >
        <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
          <div style={{ width: 10, height: 10, borderRadius: "50%", background: "#FF5F57" }} />
          <div style={{ width: 10, height: 10, borderRadius: "50%", background: "#FEBC2E" }} />
          <div style={{ width: 10, height: 10, borderRadius: "50%", background: "#28C840" }} />
          <span style={{ marginLeft: 12, fontSize: 11, color: "rgba(255,255,255,0.6)" }}>sprint0 · gitlab-mcp + mongo-mcp · live</span>
        </div>
        {events.slice(0, idx).map((e, i) => (
          <div
            key={i}
            style={{ color: e.t.startsWith("✓") ? "var(--orange)" : e.t.startsWith("→") ? "#FEBC2E" : "var(--paper)", marginBottom: 2 }}
          >
            {e.t && (
              <>
                <span style={{ color: "var(--ink-mute)" }}>[{String(i + 1).padStart(2, "0")}]</span> {e.t}
              </>
            )}
          </div>
        ))}
        {!done && <div style={{ display: "inline-block", width: 8, height: 14, background: "var(--orange)", animation: "blink 1s infinite" }} />}
      </div>

      {done && (
        <div className="card" style={{ padding: 18, background: "var(--orange-soft)", borderColor: "var(--orange)" }}>
          <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
            <Mascot size={48} expression="cheer" />
            <div style={{ flex: 1 }}>
              <div className="display" style={{ fontSize: 18, color: "var(--orange-deep)" }}>
                All done!
              </div>
              <div style={{ fontSize: 13, color: "var(--ink-soft)" }}>32 issues open · client report sent · returning you to dashboard...</div>
            </div>
            <button onClick={onDone} className="btn btn-sm btn-primary">
              See it
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
