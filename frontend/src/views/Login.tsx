import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useLogin } from "../features/auth/useAuth";
import { ROLE_HOME, memberToRole } from "../features/nav/nav";
import { api } from "../lib/api";
import type { Member } from "../lib/api";
import { Mascot, Sprint0Logo } from "../components/Mascot";
import { DISCIPLINE_LABEL } from "../lib/relayUtils";

/* Account picker login. No passwords (demo): pick your account → POST /api/auth/login
   → token stored in sessionStorage → enter the app. Each browser window logs in
   independently, so several personas can be driven side-by-side. */

const TRUST_COLOR: Record<string, string> = {
  high: "var(--green)",
  medium: "var(--blue)",
  low: "var(--text-tertiary)",
};

export function Login() {
  const login = useLogin();
  const navigate = useNavigate();
  const [members, setMembers] = useState<Member[] | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [manual, setManual] = useState("");

  useEffect(() => {
    let cancelled = false;
    api
      .developers()
      .then((rows) => {
        if (!cancelled) setMembers(rows);
      })
      .catch((e) => {
        if (!cancelled) setLoadErr(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const signIn = async (username: string) => {
    if (!username.trim()) return;
    setBusy(username);
    setErr(null);
    try {
      const res = await login.mutateAsync(username.trim());
      navigate({ to: `/${ROLE_HOME[memberToRole(res.member)]}` as "/" });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div style={{ height: "100vh", display: "grid", gridTemplateColumns: "1fr 1fr", background: "var(--bg-app)" }}>
      {/* Left — brand panel */}
      <div
        style={{
          background: "var(--ink-fill)",
          color: "var(--bg-elevated)",
          padding: 48,
          position: "relative",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
        }}
      >
        <Sprint0Logo size={22} color="var(--bg-elevated)" markColor="var(--bg-elevated)" markOutline="var(--text-primary)" />
        <div style={{ position: "relative", zIndex: 2 }}>
          <div className="kicker" style={{ color: "rgba(255,255,255,0.7)" }}>
            Sign in
          </div>
          <h1 className="display" style={{ fontSize: 52, lineHeight: 1, margin: "12px 0 16px" }}>
            Who's
            <br />
            on the baton?
          </h1>
          <p style={{ fontSize: 17, opacity: 0.92, maxWidth: 360, lineHeight: 1.45 }}>
            Pick your account. You'll see only your work — the manager orchestrates, each lead ratifies their own slice.
          </p>
        </div>
        <div style={{ position: "absolute", right: -30, bottom: -40, transform: "rotate(8deg)" }}>
          <Mascot size={260} expression="happy" color="var(--text-primary)" outline="var(--bg-elevated)" />
        </div>
      </div>

      {/* Right — account picker */}
      <div style={{ display: "flex", flexDirection: "column", padding: 48, justifyContent: "center", overflow: "auto" }}>
        <div style={{ maxWidth: 480, width: "100%", margin: "0 auto" }}>
          <div className="kicker">The roster</div>
          <div className="display" style={{ fontSize: 30, margin: "6px 0 20px" }}>
            Choose an account.
          </div>

          {loadErr && (
            <div
              className="card-soft"
              style={{ padding: 14, marginBottom: 14, borderColor: "var(--ink-fill)", color: "var(--text-primary)", fontFamily: "var(--font-mono)", fontSize: 12 }}
            >
              Couldn't load the roster: {loadErr}
            </div>
          )}

          {!members && !loadErr && (
            <div style={{ display: "flex", alignItems: "center", gap: 12, color: "var(--text-tertiary)", fontSize: 14 }}>
              <span
                style={{ width: 20, height: 20, borderRadius: "50%", border: "2.5px solid var(--ink-fill)", borderTopColor: "transparent", animation: "spin-slow 0.8s linear infinite" }}
              />
              Loading roster…
            </div>
          )}

          {members && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {members.length === 0 && (
                <div className="card-soft" style={{ padding: 20, color: "var(--text-secondary)", fontSize: 14 }}>
                  No accounts on the roster yet. Use the field below to sign in by username.
                </div>
              )}
              {members.map((m) => (
                <AccountCard key={m.username} member={m} busy={busy === m.username} onClick={() => signIn(m.username)} />
              ))}
            </div>
          )}

          {/* Sign in by username (covers the manager + any account not in the dev roster). */}
          <div className="card-soft" style={{ padding: 16, marginTop: 16, background: "var(--bg-app)" }}>
            <div className="kicker" style={{ marginBottom: 8 }}>
              Or sign in by username
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                signIn(manual);
              }}
              style={{ display: "flex", gap: 8 }}
            >
              <input
                value={manual}
                onChange={(e) => setManual(e.target.value)}
                placeholder="e.g. the manager's username"
                style={{
                  flex: 1,
                  padding: "9px 12px",
                  border: "1.5px solid var(--border-strong)",
                  borderRadius: 8,
                  fontSize: 14,
                  background: "var(--bg-elevated)",
                  outline: "none",
                  fontFamily: "inherit",
                }}
              />
              <button type="submit" className="btn btn-primary btn-sm" disabled={!manual.trim() || busy != null} style={{ opacity: !manual.trim() || busy != null ? 0.5 : 1 }}>
                {busy === manual.trim() ? "…" : "Sign in"}
              </button>
            </form>
          </div>

          {err && (
            <div style={{ color: "var(--text-primary)", fontSize: 13, marginTop: 12, fontFamily: "var(--font-mono)" }}>{err}</div>
          )}
        </div>
      </div>
    </div>
  );
}

function AccountCard({ member, busy, onClick }: { member: Member; busy: boolean; onClick: () => void }) {
  const isManager = member.role === "manager";
  const initials = member.name
    .split(/\s+/)
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
  const trustC = TRUST_COLOR[member.trust_level] ?? "var(--text-tertiary)";
  const overLoaded = member.load >= 100;

  return (
    <button
      onClick={onClick}
      disabled={busy}
      className="card-soft card-hover"
      style={{ padding: 14, textAlign: "left", display: "flex", alignItems: "center", gap: 14, cursor: "pointer", opacity: busy ? 0.6 : 1 }}
    >
      <div
        style={{
          width: 44,
          height: 44,
          borderRadius: "50%",
          background: isManager ? "var(--ink-fill)" : "var(--blue)",
          color: "var(--bg-elevated)",
          border: "2px solid var(--text-primary)",
          display: "grid",
          placeItems: "center",
          fontWeight: 800,
          fontSize: 14,
          flexShrink: 0,
        }}
      >
        {initials || "?"}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontWeight: 700, fontSize: 15, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{member.name}</span>
          <span className="chip" style={{ fontSize: 9, padding: "1px 7px", textTransform: "capitalize" }}>
            {member.role}
          </span>
        </div>
        <div style={{ fontSize: 12, color: "var(--text-tertiary)", fontFamily: "var(--font-mono)" }}>
          {isManager ? "orchestrates" : member.discipline ? DISCIPLINE_LABEL[member.discipline] : "unassigned"}
          {!isManager && <> · {member.seniority}</>}
        </div>
      </div>
      {!isManager && (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
          <span
            className="chip"
            style={{ fontSize: 10, padding: "2px 8px", background: overLoaded ? "var(--bg-secondary)" : "var(--bg-app)", color: overLoaded ? "var(--amber)" : "var(--text-secondary)" }}
          >
            load {member.load}%
          </span>
          <span style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 10, fontWeight: 700, color: trustC }}>
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: trustC }} />
            {member.trust_level}
          </span>
        </div>
      )}
      <span style={{ fontSize: 16, color: "var(--text-quaternary)" }}>→</span>
    </button>
  );
}
