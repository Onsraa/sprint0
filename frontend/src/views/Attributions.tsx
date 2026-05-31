import { useEffect, useState } from "react";
import { api, type Attribution, type Member } from "../lib/api";

/* Merge-attribution queue (R3): merges sprint0 couldn't map to a roster member land here —
   the human fallback in the attribution chain. The manager picks who earned the merge
   (AI pre-fills a fuzzy-matched suggestion); resolving grows that member's passport. */

export function Attributions() {
  const [items, setItems] = useState<Attribution[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [picks, setPicks] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([api.attributions(), api.developers()])
      .then(([atts, devs]) => {
        if (cancelled) return;
        setItems(atts);
        setMembers(devs);
        setErr(null);
      })
      .catch((e) => !cancelled && setErr(e instanceof Error ? e.message : String(e)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, []);

  const pickFor = (a: Attribution) => picks[a.id] ?? a.suggested ?? members[0]?.username ?? "";

  const resolve = async (a: Attribution) => {
    const username = pickFor(a);
    if (!username) return;
    setBusy(a.id);
    setErr(null);
    try {
      await api.resolveAttribution(a.id, { username });
      setItems((xs) => xs.filter((x) => x.id !== a.id));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const count = items.length;

  return (
    <div style={{ maxWidth: 920, margin: "0 auto" }}>
      <div className="kicker">Merges</div>
      <div className="display" style={{ fontSize: 28, marginTop: 4 }}>
        {count === 0 ? "Attribution queue" : `${count} merge${count === 1 ? "" : "s"} awaiting attribution`}
      </div>
      <div style={{ color: "var(--text-secondary)", fontSize: 13, marginTop: 4 }}>
        Merges sprint0 couldn't map to a roster member. Assign the runner who earned it — their passport grows.
      </div>

      {err && <div className="card-soft mono" style={{ marginTop: 16, padding: 12, color: "var(--text-primary)", fontSize: 12 }}>{err}</div>}

      <div style={{ marginTop: 16 }}>
        {loading ? (
          <div className="card-soft" style={{ padding: 24, textAlign: "center", color: "var(--text-secondary)" }}>Loading…</div>
        ) : count === 0 ? (
          <div className="card-soft" style={{ padding: 24, textAlign: "center", border: "1px dashed var(--border-strong)" }}>
            <div className="display" style={{ fontSize: 18 }}>No merges awaiting attribution.</div>
            <div style={{ color: "var(--text-secondary)", fontSize: 13, marginTop: 6 }}>
              When a merge can't be matched to a roster member, it shows up here for your call.
            </div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {items.map((a) => (
              <div key={a.id} className="card-soft" style={{ padding: 16, display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
                <div style={{ flex: 1, minWidth: 200 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span className="mono" style={{ fontWeight: 700 }}>@{a.gitlab_username}</span>
                    <span className="chip chip-soft" style={{ fontSize: 10 }}>{a.task_type}</span>
                    <span className="mono" style={{ fontSize: 11, color: "var(--text-tertiary)" }}>score {a.score.toFixed(2)}</span>
                  </div>
                  {a.suggested && (
                    <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 6 }}>
                      AI suggests: <b>{a.suggested}</b>
                    </div>
                  )}
                </div>
                <select
                  value={pickFor(a)}
                  onChange={(e) => setPicks((p) => ({ ...p, [a.id]: e.target.value }))}
                  style={{ padding: "8px 10px", border: "1.5px solid var(--border-strong)", borderRadius: 8, fontSize: 13, background: "var(--bg-elevated)", fontFamily: "inherit" }}
                >
                  {members.map((m) => (
                    <option key={m.username} value={m.username}>
                      {m.name} ({m.username})
                    </option>
                  ))}
                </select>
                <button
                  onClick={() => resolve(a)}
                  disabled={busy != null || !pickFor(a)}
                  className="btn btn-primary btn-sm"
                  style={{ opacity: busy != null ? 0.5 : 1 }}
                >
                  {busy === a.id ? "Attributing…" : "Attribute →"}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
