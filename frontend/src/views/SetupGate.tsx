import { useState } from "react";
import { useApp } from "../app/AppContext";
import { LS } from "../lib/storage";
import { Mascot, Sprint0Logo } from "../components/Mascot";

interface Conns {
  gitlab: boolean;
  mongo: boolean;
  gemini: boolean;
}

export function SetupGate() {
  const { setSetupDone } = useApp();
  const [step, setStep] = useState(0);
  const [conns, setConns] = useState<Conns>({ gitlab: false, mongo: false, gemini: false });
  const [email, setEmail] = useState("");
  const [org, setOrg] = useState("");

  const steps = [
    { id: "welcome", t: "Welcome" },
    { id: "account", t: "Account" },
    { id: "connect", t: "Connect" },
    { id: "ready", t: "Ready" },
  ];

  const allConnected = conns.gitlab && conns.mongo && conns.gemini;
  const canContinue = [true, email.includes("@") && org.length > 1, allConnected, true][step];

  const finish = () => {
    LS.set("setup", true);
    setSetupDone(true);
  };

  return (
    <div style={{ height: "100vh", display: "grid", gridTemplateColumns: "1fr 1fr", background: "var(--cream)" }}>
      {/* Left — visual */}
      <div
        style={{
          background: "var(--orange)",
          color: "var(--paper)",
          padding: 48,
          position: "relative",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
        }}
      >
        <Sprint0Logo size={22} color="var(--paper)" markColor="var(--paper)" markOutline="var(--ink)" />

        <div style={{ position: "relative", zIndex: 2 }}>
          <div className="kicker" style={{ color: "rgba(255,255,255,0.7)" }}>
            Step {step + 1} / {steps.length}
          </div>
          <h1 className="display" style={{ fontSize: 56, lineHeight: 1, margin: "12px 0 16px" }}>
            {step === 0 && (
              <>
                Hi, I'm <span style={{ whiteSpace: "nowrap" }}>Zero. →</span>
              </>
            )}
            {step === 1 && (
              <>
                Who are
                <br />
                you?
              </>
            )}
            {step === 2 && (
              <>
                Plug me
                <br />
                into stuff.
              </>
            )}
            {step === 3 && (
              <>
                We're
                <br />
                in business.
              </>
            )}
          </h1>
          <p style={{ fontSize: 17, opacity: 0.92, maxWidth: 360, lineHeight: 1.45 }}>
            {step === 0 && "I'll handle the boring growth + ops stuff. You build. I orchestrate. Takes a minute."}
            {step === 1 && "So I can sign things in your name and post your client reports."}
            {step === 2 &&
              "I need GitLab for scaffolding, Mongo for memory, Gemini for brain. Don't worry — MCP-standard, revokable anytime."}
            {step === 3 && "Drop a brief, drop a CV, or watch me work. Whatever you want."}
          </p>
        </div>

        <div
          style={{
            position: "absolute",
            right: -30,
            bottom: -40,
            transform: step === 3 ? "rotate(-8deg)" : "rotate(8deg)",
            transition: "transform 600ms",
          }}
        >
          <Mascot
            size={260}
            expression={step === 0 ? "happy" : step === 1 ? "focused" : step === 2 ? "working" : "cheer"}
            color="var(--orange-deep)"
            outline="var(--paper)"
          />
        </div>

        <div style={{ display: "flex", gap: 8, position: "relative", zIndex: 2 }}>
          {steps.map((s, i) => (
            <div
              key={s.id}
              style={{
                height: 4,
                flex: i === step ? 3 : 1,
                borderRadius: 4,
                background: i <= step ? "var(--paper)" : "rgba(255,255,255,0.3)",
                transition: "all 400ms",
              }}
            />
          ))}
        </div>
      </div>

      {/* Right — form */}
      <div style={{ display: "flex", flexDirection: "column", padding: 48, justifyContent: "center" }}>
        <div style={{ maxWidth: 480, width: "100%", margin: "0 auto" }}>
          {step === 0 && <SetupWelcome />}
          {step === 1 && <SetupAccount email={email} setEmail={setEmail} org={org} setOrg={setOrg} />}
          {step === 2 && <SetupConnect conns={conns} setConns={setConns} />}
          {step === 3 && <SetupReady />}

          <div style={{ display: "flex", gap: 12, marginTop: 32, justifyContent: "space-between" }}>
            {step > 0 ? (
              <button onClick={() => setStep(step - 1)} className="btn btn-ghost btn-sm">
                ← Back
              </button>
            ) : (
              <div />
            )}
            {step < 3 ? (
              <button
                onClick={() => setStep(step + 1)}
                disabled={!canContinue}
                className="btn btn-primary"
                style={{ opacity: canContinue ? 1 : 0.4 }}
              >
                Continue →
              </button>
            ) : (
              <button onClick={finish} className="btn btn-primary">
                Enter sprint0 →
              </button>
            )}
          </div>

          <button
            onClick={finish}
            style={{ marginTop: 18, fontSize: 12, color: "var(--ink-mute)", textDecoration: "underline", textUnderlineOffset: 3 }}
          >
            Skip setup (demo mode)
          </button>
        </div>
      </div>
    </div>
  );
}

function SetupWelcome() {
  const bullets = [
    "Scaffolds GitLab projects from messy briefs",
    "Onboards new hires from a single CV",
    "Hides every file your dev doesn't need to see",
  ];
  return (
    <div>
      <div className="kicker">What I do</div>
      <div className="display" style={{ fontSize: 32, margin: "6px 0 24px" }}>
        Three things, well.
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {bullets.map((b, i) => (
          <div
            key={i}
            className="card-soft"
            style={{ padding: "14px 16px", display: "flex", gap: 12, alignItems: "center", animation: `pop-in 400ms ${i * 0.12}s both` }}
          >
            <div
              style={{
                width: 28,
                height: 28,
                borderRadius: 8,
                background: "var(--orange)",
                color: "var(--paper)",
                display: "grid",
                placeItems: "center",
                fontWeight: 800,
                fontSize: 13,
                border: "1.5px solid var(--ink)",
              }}
            >
              {i + 1}
            </div>
            <div style={{ fontWeight: 600, fontSize: 14 }}>{b}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

interface AccountProps {
  email: string;
  setEmail: (v: string) => void;
  org: string;
  setOrg: (v: string) => void;
}

function SetupAccount({ email, setEmail, org, setOrg }: AccountProps) {
  return (
    <div>
      <div className="kicker">Account</div>
      <div className="display" style={{ fontSize: 32, margin: "6px 0 24px" }}>
        Quick intro.
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <Field label="Agency / org name" value={org} onChange={setOrg} placeholder="Dusk Studio" />
        <Field label="Work email" value={email} onChange={setEmail} placeholder="you@dusk.studio" type="email" />
        <div style={{ padding: 12, background: "var(--cream)", borderRadius: 10, fontSize: 12, color: "var(--ink-mute)", lineHeight: 1.5 }}>
          Zero will sign Sprint 0 client reports as <b>{org || "your-org"}</b>. You can change this later.
        </div>
      </div>
    </div>
  );
}

interface FieldProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
}

function Field({ label, value, onChange, placeholder, type = "text" }: FieldProps) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <span style={{ fontSize: 12, fontWeight: 700, color: "var(--ink-mute)", letterSpacing: "0.04em", textTransform: "uppercase" }}>
        {label}
      </span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        style={{
          padding: "12px 14px",
          border: "1.5px solid var(--line-strong)",
          borderRadius: 10,
          fontSize: 15,
          background: "var(--paper)",
          outline: "none",
          fontFamily: "inherit",
          transition: "border-color 120ms",
        }}
        onFocus={(e) => {
          e.currentTarget.style.borderColor = "var(--orange)";
        }}
        onBlur={(e) => {
          e.currentTarget.style.borderColor = "var(--line-strong)";
        }}
      />
    </label>
  );
}

interface ConnectProps {
  conns: Conns;
  setConns: (c: Conns) => void;
}

function SetupConnect({ conns, setConns }: ConnectProps) {
  const tools: { id: keyof Conns; n: string; d: string; color: string; glyph: GlyphKind }[] = [
    { id: "gitlab", n: "GitLab", d: "Scaffolds groups, repos, issues, MRs.", color: "#FC6D26", glyph: "gitlab" },
    { id: "mongo", n: "MongoDB", d: "Stores agency memory + dev passports.", color: "#13AA52", glyph: "mongo" },
    { id: "gemini", n: "Gemini", d: "Reasons across briefs, CVs, and codebases.", color: "#4285F4", glyph: "gemini" },
  ];
  const [busy, setBusy] = useState<keyof Conns | null>(null);

  const connect = (id: keyof Conns) => {
    setBusy(id);
    setTimeout(() => {
      setConns({ ...conns, [id]: true });
      setBusy(null);
    }, 900);
  };

  return (
    <div>
      <div className="kicker">MCP connections</div>
      <div className="display" style={{ fontSize: 32, margin: "6px 0 24px" }}>
        Plug in 3 things.
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {tools.map((t, i) => {
          const isConnected = conns[t.id];
          const isBusy = busy === t.id;
          return (
            <div
              key={t.id}
              className="card-soft"
              style={{
                padding: 14,
                display: "flex",
                alignItems: "center",
                gap: 14,
                animation: `pop-in 400ms ${i * 0.08}s both`,
                borderColor: isConnected ? "var(--positive)" : "var(--line-strong)",
                background: isConnected ? "rgba(47,138,78,0.04)" : "var(--paper)",
              }}
            >
              <div
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 10,
                  background: t.color,
                  color: "var(--paper)",
                  display: "grid",
                  placeItems: "center",
                  border: "1.5px solid var(--ink)",
                }}
              >
                <BrandGlyph kind={t.glyph} />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: 15 }}>{t.n}</div>
                <div style={{ fontSize: 12, color: "var(--ink-mute)" }}>{t.d}</div>
              </div>
              {isConnected ? (
                <div className="chip" style={{ background: "var(--positive)", color: "var(--paper)", borderColor: "var(--positive)" }}>
                  ✓ connected
                </div>
              ) : isBusy ? (
                <div
                  style={{
                    width: 22,
                    height: 22,
                    borderRadius: "50%",
                    border: "2.5px solid var(--orange)",
                    borderTopColor: "transparent",
                    animation: "spin-slow 0.8s linear infinite",
                  }}
                />
              ) : (
                <button onClick={() => connect(t.id)} className="btn btn-sm btn-primary" style={{ padding: "7px 14px" }}>
                  Connect
                </button>
              )}
            </div>
          );
        })}
      </div>
      <div
        style={{
          marginTop: 14,
          padding: 10,
          background: "var(--cream)",
          borderRadius: 10,
          fontSize: 11,
          color: "var(--ink-mute)",
          display: "flex",
          gap: 8,
          alignItems: "center",
        }}
      >
        <span style={{ fontFamily: "var(--font-mono)", color: "var(--ink-soft)", fontWeight: 700 }}>MCP</span>
        Model Context Protocol — standard, audited tool access. Revoke anytime in Settings.
      </div>
    </div>
  );
}

function SetupReady() {
  const cards = [
    { t: "Drop a client brief", d: "Sprint 0 in 60 seconds.", color: "var(--orange)" },
    { t: "Onboard a new dev", d: "Drop their CV — I'll build a passport.", color: "var(--info)" },
    { t: "Just look around", d: "Show me what's possible.", color: "var(--positive)" },
  ];
  return (
    <div>
      <div className="kicker">All set</div>
      <div className="display" style={{ fontSize: 32, margin: "6px 0 24px" }}>
        What do you want to do first?
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {cards.map((c, i) => (
          <div
            key={i}
            className="card-soft card-hover"
            style={{ padding: 16, display: "flex", alignItems: "center", gap: 14, animation: `pop-in 400ms ${i * 0.08}s both`, cursor: "pointer" }}
          >
            <div style={{ width: 8, height: 40, background: c.color, borderRadius: 4 }} />
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700, fontSize: 15 }}>{c.t}</div>
              <div style={{ fontSize: 12, color: "var(--ink-mute)" }}>{c.d}</div>
            </div>
            <div style={{ fontSize: 18, color: "var(--ink-mute)" }}>→</div>
          </div>
        ))}
      </div>
    </div>
  );
}

type GlyphKind = "gitlab" | "mongo" | "gemini";

function BrandGlyph({ kind }: { kind: GlyphKind }) {
  if (kind === "gitlab")
    return (
      <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
        <path d="M12 22l4-12h-8l4 12zm-10-12l2 8 8-8H2zm20 0L20 18l-8-8h10z" />
      </svg>
    );
  if (kind === "mongo")
    return (
      <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
        <path d="M12 2c-1 4-6 8-6 13 0 4 3 7 6 7s6-3 6-7c0-5-5-9-6-13z" />
      </svg>
    );
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
      <path d="M12 2L14 10L22 12L14 14L12 22L10 14L2 12L10 10z" />
    </svg>
  );
}
