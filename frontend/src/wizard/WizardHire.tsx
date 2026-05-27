import { useState } from "react";
import { useApp } from "../app/AppContext";
import { Mascot } from "../components/Mascot";
import { api } from "../lib/api";
import type { Member } from "../lib/api";

/* baton — Hire wizard, wired to the real gateway: drop/paste a CV → POST /api/developers
   (Gemini parses it, links the GitLab user, seeds a low-trust passport in Mongo) → the new
   member joins the roster (login + assignment pool). The junior added live in the demo. */

const DEMO_JUNIOR_CV = `Jamie Lee — Junior Developer
1 year of experience, bootcamp graduate (2025).
Skills: HTML, CSS, JavaScript, basic React, Figma basics.
Built: a personal portfolio site, a to-do app, and a landing page on a team bootcamp project.
Keen to grow into UI/UX and frontend work. No production backend or DevOps experience yet.`;

const INFO = { background: "var(--info)", color: "var(--paper)", borderColor: "var(--info)" };

export function WizardHire() {
  const { setWizardOpen } = useApp();
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Member | null>(null);

  const close = () => setWizardOpen(false);
  const canSubmit = !busy && (!!file || text.trim().length > 20);

  const onboard = async () => {
    setBusy(true);
    setError(null);
    try {
      setResult(await api.addDeveloper(file ? { file } : { text }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      onClick={close}
      style={{ position: "fixed", inset: 0, background: "rgba(26,20,16,0.5)", backdropFilter: "blur(6px)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", padding: 24, animation: "pop-in 240ms" }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ width: "100%", maxWidth: 820, maxHeight: "calc(100vh - 48px)", background: "var(--cream)", borderRadius: 24, border: "2px solid var(--ink)", boxShadow: "10px 10px 0 var(--ink)", display: "flex", flexDirection: "column", overflow: "hidden" }}
      >
        <div style={{ padding: "18px 24px", borderBottom: "1.5px solid var(--line)", background: "var(--paper)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <Mascot size={36} expression={result ? "cheer" : "happy"} />
            <div>
              <div className="kicker">Onboard a developer</div>
              <div style={{ fontWeight: 800, fontSize: 16 }}>Cold-start passport</div>
            </div>
          </div>
          <button onClick={close} style={{ width: 32, height: 32, borderRadius: 8, background: "var(--cream-deep)", display: "grid", placeItems: "center", fontSize: 18, fontWeight: 700 }}>×</button>
        </div>

        <div style={{ flex: 1, overflow: "auto", padding: 32 }}>
          {result ? (
            <ResultCard member={result} />
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
              <div>
                <div className="display" style={{ fontSize: 32, marginBottom: 6 }}>Drop their CV.</div>
                <div style={{ fontSize: 15, color: "var(--ink-soft)" }}>baton reads it, links the GitLab account, and seeds a low-trust passport in MongoDB.</div>
              </div>
              <label
                className="card-soft"
                style={{ padding: 20, border: `2px dashed ${file ? "var(--positive)" : "var(--ink-faint)"}`, borderRadius: 16, textAlign: "center", cursor: "pointer", background: "var(--paper)" }}
              >
                <input type="file" accept=".pdf,.txt,.md" style={{ display: "none" }} onChange={(e) => { setFile(e.target.files?.[0] ?? null); setText(""); }} />
                <div style={{ fontSize: 28 }}>📄</div>
                <div style={{ fontWeight: 700, fontSize: 15 }}>{file ? file.name : "Choose a CV file (PDF / text)"}</div>
              </label>
              <div style={{ textAlign: "center", fontSize: 12, color: "var(--ink-mute)" }}>— or paste the CV —</div>
              <textarea
                value={text}
                onChange={(e) => { setText(e.target.value); setFile(null); }}
                placeholder="Paste CV text…"
                rows={6}
                style={{ width: "100%", padding: 12, borderRadius: 12, border: "1.5px solid var(--line-strong)", fontFamily: "var(--font-mono)", fontSize: 13, resize: "vertical" }}
              />
              <button onClick={() => { setText(DEMO_JUNIOR_CV); setFile(null); }} className="btn btn-ghost btn-sm" style={{ alignSelf: "flex-start" }}>
                use the demo junior CV
              </button>
              {error && <div style={{ color: "var(--negative, #C0392B)", fontSize: 13 }}>⚠ {error}</div>}
            </div>
          )}
        </div>

        <div style={{ padding: "16px 24px", borderTop: "1.5px solid var(--line)", background: "var(--paper)", display: "flex", justifyContent: "flex-end", gap: 10 }}>
          {result ? (
            <button onClick={close} className="btn btn-sm btn-primary">Done →</button>
          ) : (
            <button onClick={onboard} disabled={!canSubmit} className="btn btn-sm" style={{ ...INFO, border: "2px solid var(--info)", borderRadius: 999, padding: "9px 16px", fontWeight: 700, opacity: canSubmit ? 1 : 0.5 }}>
              {busy ? "Onboarding…" : "Onboard →"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function ResultCard({ member }: { member: Member }) {
  const linked = member.gitlab_user_id != null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div className="display" style={{ fontSize: 28 }}>{member.name} joined the team.</div>
      <div className="card-soft" style={{ padding: 18, display: "flex", flexDirection: "column", gap: 10 }}>
        <Row k="GitLab" v={linked ? `@${member.gitlab_username} · linked ✓ (native assignee)` : `@${member.gitlab_username} · label-only (no matching GitLab account)`} />
        <Row k="Role" v={`${member.seniority ?? "junior"} ${member.discipline ?? "developer"}`} />
        <Row k="Trust" v={`${member.trust_level} (cold-start) — grows per-discipline with every merge`} />
        <Row k="Skills" v={member.skills_text} />
      </div>
      <div style={{ padding: 12, background: "var(--cream)", borderRadius: 10, fontSize: 13, color: "var(--ink-soft)" }}>
        In MongoDB now and in the assignment pool — eligible for the next plan (low-risk first; out-of-discipline work is flagged as a stretch).
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div style={{ display: "flex", gap: 12, fontSize: 13 }}>
      <span className="mono" style={{ color: "var(--info)", fontWeight: 800, textTransform: "uppercase", minWidth: 64 }}>{k}</span>
      <span style={{ flex: 1, color: "var(--ink-soft)" }}>{v}</span>
    </div>
  );
}
