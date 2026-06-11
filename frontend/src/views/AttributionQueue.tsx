/* sprint0 — Attributions: unmatched merges. A merge whose GitLab user matched NO roster member lands here for
   the manager to attribute to the real person (the AI fuzzy-suggests one). Wires the existing
   GET /api/attributions + POST /api/attributions/{id}/resolve. Manager-only. */
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ViewChrome } from "../components/ViewChrome";
import { Avatar, Badge, Button } from "../components/ui";
import { Icon } from "../lib/icon";
import { useApp } from "../app/useApp";
import { api } from "../lib/api";
import type { Attribution } from "../lib/api";

export function AttributionQueue() {
  const { members } = useApp();
  const qc = useQueryClient();
  const { data: list = [] } = useQuery({ queryKey: ["attributions"], queryFn: () => api.attributions() });

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <ViewChrome breadcrumb={["Studio", "Attributions"]}>
        <Badge tone="outline" mono>{list.length} to attribute</Badge>
      </ViewChrome>
      <div style={{ flex: 1, overflow: "auto" }}>
        <div style={{ maxWidth: 720, margin: "0 auto", padding: "24px 24px 48px" }}>
          <h1 style={{ fontSize: 22, fontWeight: 600, letterSpacing: "-0.4px", margin: "0 0 4px" }}>Unattributed merges</h1>
          <p style={{ fontSize: 13.5, color: "var(--text-tertiary)", margin: "0 0 22px", lineHeight: 1.55 }}>
            These merges came in under a GitLab user that matched no one on the roster. Attribute each to the real
            person — their passport trust grows from it. The AI fuzzy-suggests a match; you confirm.
          </p>
          {list.length === 0 ? (
            <div style={{ border: "0.5px dashed var(--border-strong)", borderRadius: "var(--r-lg)", padding: "30px 18px", textAlign: "center", background: "var(--bg-elevated)" }}>
              <Icon name="check" size={20} style={{ color: "var(--green)" }} />
              <div style={{ fontSize: 13, color: "var(--text-tertiary)", marginTop: 9 }}>Every merge matched a roster member — nothing to attribute.</div>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {list.map((a) => <AttributionRow key={a.id} a={a} members={members} onResolved={() => qc.invalidateQueries({ queryKey: ["attributions"] })} />)}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function AttributionRow({ a, members, onResolved }: { a: Attribution; members: any[]; onResolved: () => void }) {
  const roster = members.filter((m: any) => m.disciplines?.length || m.discipline);  // anyone who covers a lane (incl. a working manager)
  const [pick, setPick] = useState<string>(a.suggested ?? roster[0]?.username ?? "");
  const [busy, setBusy] = useState(false);
  const suggestedName = members.find((m: any) => m.username === a.suggested)?.name;
  const confirm = async () => {
    if (!pick) return;
    setBusy(true);
    try {
      await api.resolveAttribution(a.id, { username: pick });
      toast.success(`Attributed to ${members.find((m: any) => m.username === pick)?.name?.split(" ")[0] ?? pick}`);
      onResolved();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Could not attribute"); }
    finally { setBusy(false); }
  };
  return (
    <div style={{ border: "0.5px solid var(--border)", borderRadius: "var(--r-lg)", padding: 14, background: "var(--bg-elevated)", boxShadow: "var(--shadow-1)", display: "flex", alignItems: "center", gap: 14 }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}>
          <Icon name="gitlab" size={14} style={{ color: "var(--text-tertiary)" }} />
          <span className="mono" style={{ fontSize: 13, fontWeight: 600 }}>@{a.gitlab_username}</span>
          <Badge tone="outline" mono>{a.task_type}</Badge>
          <span className="mono" style={{ fontSize: 10.5, color: "var(--text-quaternary)" }}>score {a.score.toFixed(2)}</span>
        </div>
        {a.suggested && <div style={{ fontSize: 11.5, color: "var(--text-tertiary)" }}>AI suggests <b style={{ color: "var(--text-secondary)", fontWeight: 600 }}>{suggestedName ?? a.suggested}</b> — confirm or change.</div>}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
        {pick && <Avatar name={members.find((m: any) => m.username === pick)?.name ?? pick} size={22} />}
        <select value={pick} onChange={(e) => setPick(e.target.value)}
          style={{ height: 30, padding: "0 8px", fontSize: 12.5, borderRadius: "var(--r-md)", border: "0.5px solid var(--border-strong)", background: "var(--bg-secondary)", cursor: "pointer" }}>
          {roster.map((m: any) => <option key={m.username} value={m.username}>{m.name}</option>)}
        </select>
        <Button variant="primary" size="sm" icon="check" disabled={busy || !pick} onClick={confirm}>Attribute</Button>
      </div>
    </div>
  );
}
