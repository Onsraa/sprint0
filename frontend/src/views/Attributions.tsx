/* sprint0 — Merge attribution (§8). Map GitLab merges to the right roster member
   so credit + trust update automatically; ambiguous ones prompt a member pick.
   Ported 1:1 from v4 mockup app/Merges.jsx; mock constants swapped for the useApp() adapter
   (attributions/resolveAttribution from the store, MEMBERS→members, byUser→members.find). */
import { useState } from "react";
import { Button, Avatar, Badge, DiscDot, DISC } from "../components/ui";
import { Icon } from "../lib/icon";
import { ViewChrome } from "../components/ViewChrome";
import { useApp } from "../app/useApp";

export function Attributions() {
  const { attributions, resolveAttribution, members } = useApp();
  const byUser = (u: string) => members.find((m: any) => m.username === u);
  const open = (attributions as any[]).filter(a => !a.resolved);
  const resolved = (attributions as any[]).filter(a => a.resolved);
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <ViewChrome breadcrumb={["Team", "Merges"]}>
        <span className="mono" style={{ fontSize: 11, color: "var(--text-quaternary)" }}>{open.length} unresolved</span>
      </ViewChrome>
      <div style={{ flex: 1, overflow: "auto" }}>
        <div style={{ maxWidth: 760, margin: "0 auto", padding: "22px 24px 40px" }}>
          <div style={{ marginBottom: 18 }}>
            <h1 style={{ fontSize: 20, fontWeight: 600, letterSpacing: "-0.3px", margin: 0 }}>Merge attribution</h1>
            <p style={{ fontSize: 13, color: "var(--text-tertiary)", margin: "5px 0 0", lineHeight: 1.5 }}>
              GitLab merges mapped to roster members — credit and trust update on resolve.
            </p>
          </div>

          {open.length > 0 && (
            <>
              <div className="kicker" style={{ marginBottom: 10 }}>Needs a call · {open.length}</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 24 }}>
                {open.map(a => <AttrRow key={a.id} a={a} members={members} byUser={byUser} onResolve={resolveAttribution} />)}
              </div>
            </>
          )}

          <div className="kicker" style={{ marginBottom: 10 }}>Resolved · {resolved.length}</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {resolved.map(a => <AttrRow key={a.id} a={a} members={members} byUser={byUser} onResolve={resolveAttribution} />)}
          </div>
        </div>
      </div>
    </div>
  );
}

function AttrRow({ a, members, byUser, onResolve }: { a: any; members: any[]; byUser: (u: string) => any; onResolve: (id: string, username: string) => void }) {
  const [picking, setPicking] = useState(false);
  const resolvedM = a.resolved ? byUser(a.resolved) : null;
  const noCandidate = a.candidates.length === 0;
  return (
    <div style={{ border: `0.5px solid ${a.ambiguous ? "var(--text-primary)" : "var(--border)"}`, borderRadius: "var(--r-lg)",
      background: "var(--bg-elevated)", boxShadow: "var(--shadow-1)", overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "13px 14px" }}>
        <span style={{ width: 30, height: 30, borderRadius: "var(--r-md)", display: "grid", placeItems: "center", background: "var(--bg-secondary)", color: "var(--text-tertiary)", flexShrink: 0 }}>
          <Icon name="gitlab" size={16} />
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{a.mr_title}</div>
          <div className="mono" style={{ fontSize: 11, color: "var(--text-quaternary)", marginTop: 2 }}>{a.project} · gitlab:@{a.gitlab_author}</div>
        </div>
        {a.resolved ? (
          <>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <Avatar name={resolvedM.name} size={20} />
              <span style={{ fontSize: 12.5, fontWeight: 500 }}>{resolvedM.name.split(" ")[0]}</span>
            </span>
            {a.trust_delta && <Badge tone="green">trust {a.trust_delta}</Badge>}
          </>
        ) : noCandidate ? (
          <Button variant="secondary" size="sm" icon="link" onClick={() => setPicking(p => !p)}>Link GitLab id</Button>
        ) : (
          <Button variant="primary" size="sm" icon="team" onClick={() => setPicking(p => !p)}>Resolve · {a.candidates.length}</Button>
        )}
      </div>
      {picking && !a.resolved && (
        <div style={{ borderTop: "0.5px solid var(--border-subtle)", padding: 12, background: "var(--bg-base)" }}>
          <div className="kicker" style={{ marginBottom: 8 }}>{noCandidate ? "Pick a member to link this GitLab id" : "Which member made this merge?"}</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {(noCandidate ? members.filter((m: any) => m.role !== "manager") : a.candidates.map(byUser)).map((m: any) => (
              <button key={m.username} onClick={() => { onResolve(a.id, m.username); setPicking(false); }}
                style={{ display: "inline-flex", alignItems: "center", gap: 7, height: 32, padding: "0 11px 0 5px", borderRadius: "var(--r-pill)",
                  background: "var(--bg-elevated)", border: "0.5px solid var(--border-strong)", boxShadow: "var(--shadow-1)" }}>
                <Avatar name={m.name} size={20} />
                <span style={{ fontSize: 12.5, fontWeight: 500 }}>{m.name}</span>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 10.5, color: "var(--text-quaternary)" }}><DiscDot d={m.discipline} size={6} />{DISC[m.discipline]?.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
