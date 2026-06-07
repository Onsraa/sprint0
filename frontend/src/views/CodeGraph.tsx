/* sprint0 — Reuse lineage (Living Project Graph). A reused feature is ONE content-addressed node; the
 * projects that reused it are `derived_from` edges, NOT copies. "Simulate source change" = the event a
 * GitLab merge webhook would post → propose a sync task in every dependent (the owner ratifies; nothing
 * auto-applies). Reads the live "lineage" graph; reuses the work + inbox queries so the bell/board update. */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "../lib/api";
import { qk } from "../lib/query";
import { useMe } from "../features/auth/useAuth";
import { ViewChrome } from "../components/ViewChrome";
import { Button } from "../components/ui";
import { Icon } from "../lib/icon";

export function CodeGraph() {
  const { role } = useMe();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["graph", "lineage"], queryFn: () => api.getGraph("lineage") });
  const nodes = data?.nodes ?? [];
  const edges = data?.edges ?? [];
  const derived = edges.filter((e) => e.edge_type === "derived_from");
  // the source feature = the content-addressed node every derived_from edge points to (no ref_project_id)
  const source = nodes.find((n) => n.node_type === "feature" && !n.ref_project_id && derived.some((e) => e.to_path === n.path));
  const dependents = source
    ? (derived.filter((e) => e.to_path === source.path)
        .map((e) => nodes.find((n) => n.path === e.from_path))
        .filter(Boolean) as typeof nodes)
    : [];

  const sim = useMutation({
    mutationFn: () => api.simulateSourceChange({
      feature_node: source!.path, new_hash: "sha256:qpauth-next",
      summary: "rotate refresh-token TTL + fix replay window",
    }),
    onSuccess: (res) => {
      toast.success(`Proposed ${res.dependents} sync task${res.dependents === 1 ? "" : "s"}`,
        { description: "Each dependent's owner ratifies — nothing auto-applies." });
      qc.invalidateQueries({ queryKey: ["work"] });   // the planned sync tasks land in the work hub
      qc.invalidateQueries({ queryKey: qk.inbox() });  // the owner's bell pings
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Simulate failed"),
  });

  const dup = useMutation({
    mutationFn: () => api.lineageDuplicates(0.82),
    onError: (e) => toast.error(e instanceof Error ? e.message : "Dedup scan failed"),
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <ViewChrome breadcrumb={["Explore", "Lineage"]} />
      <div style={{ flex: 1, overflow: "auto" }}>
        <div style={{ maxWidth: 680, margin: "0 auto", padding: "28px 24px 48px" }}>
          <h1 style={{ fontSize: 22, fontWeight: 600, letterSpacing: "-0.4px", margin: "0 0 4px" }}>Reuse lineage</h1>
          <p style={{ fontSize: 13.5, color: "var(--text-tertiary)", margin: "0 0 24px", lineHeight: 1.55 }}>
            A reused feature is stored <b style={{ color: "var(--text-secondary)", fontWeight: 600 }}>once</b> — content-addressed by a hash of its code — and referenced by every project that reused it, not copied. Change the source and sprint0 knows exactly who derived from it, and proposes the sync.
          </p>

          {isLoading && <div style={{ color: "var(--text-tertiary)", fontSize: 13 }}>Loading the graph…</div>}
          {!isLoading && !source && <div style={{ color: "var(--text-tertiary)", fontSize: 13 }}>No reuse lineage seeded.</div>}

          {source && (
            <>
              <div style={{ border: "0.5px solid var(--border)", borderRadius: "var(--r-lg)", padding: 18, background: "var(--bg-elevated)", marginBottom: 18 }}>
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
                  <div style={{ minWidth: 0 }}>
                    <div className="kicker" style={{ marginBottom: 6 }}>Source feature</div>
                    <div style={{ fontSize: 16, fontWeight: 600, letterSpacing: "-0.2px" }}>{source.title || source.path}</div>
                    <div className="mono" style={{ fontSize: 12, color: "var(--text-tertiary)", marginTop: 4 }}>{source.content_hash || source.path}</div>
                  </div>
                  <div style={{ flexShrink: 0, textAlign: "center", border: "0.5px solid var(--border)", borderRadius: "var(--r-md)", padding: "8px 14px", background: "var(--bg-secondary)" }}>
                    <div className="mono" style={{ fontSize: 22, fontWeight: 600, letterSpacing: "-1px" }}>{dependents.length}</div>
                    <div style={{ fontSize: 10.5, color: "var(--text-tertiary)", marginTop: 2 }}>reuses · 0 copies</div>
                  </div>
                </div>
                {role === "manager" && (
                  <div style={{ marginTop: 16, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                    <Button variant="primary" size="md" icon="bolt" disabled={sim.isPending} onClick={() => sim.mutate()}>
                      {sim.isPending ? "Propagating…" : "Simulate source change"}
                    </Button>
                    <span style={{ fontSize: 12, color: "var(--text-tertiary)" }}>proposes a sync task in each dependent — the owner ratifies</span>
                  </div>
                )}
              </div>

              <div className="kicker" style={{ marginBottom: 10 }}>Derived from this — {dependents.length} project{dependents.length === 1 ? "" : "s"}</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {dependents.map((d) => (
                  <div key={d.path} style={{ display: "flex", alignItems: "center", gap: 10, border: "0.5px solid var(--border)", borderRadius: "var(--r-md)", padding: "11px 14px", background: "var(--bg-secondary)" }}>
                    <Icon name="merges" size={14} style={{ color: "var(--text-tertiary)", flexShrink: 0 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13.5, fontWeight: 500 }}>{d.title || d.path}</div>
                      <div className="mono" style={{ fontSize: 11, color: "var(--text-quaternary)" }}>{d.content_hash || "—"}</div>
                    </div>
                    <span className="mono" style={{ fontSize: 11, color: "var(--text-tertiary)", background: "var(--bg-elevated)", border: "0.5px solid var(--border)", borderRadius: 4, padding: "2px 6px" }}>{d.domain}</span>
                  </div>
                ))}
              </div>

              {role === "manager" && (
                <div style={{ marginTop: 22 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                    <div className="kicker">Semantic duplicates</div>
                    <Button variant="secondary" size="sm" icon="merges" disabled={dup.isPending} onClick={() => dup.mutate()}>
                      {dup.isPending ? "Scanning…" : "Find near-duplicates"}
                    </Button>
                  </div>
                  {dup.data && dup.data.pairs.length === 0 && (
                    <div style={{ fontSize: 12.5, color: "var(--text-tertiary)" }}>{dup.data.note || "No near-duplicates above the threshold."}</div>
                  )}
                  {dup.data?.pairs.map((p, i) => (
                    <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, border: "0.5px solid var(--amber)", borderRadius: "var(--r-md)", padding: "11px 14px", background: "var(--bg-secondary)", marginBottom: 8 }}>
                      <Icon name="merges" size={14} style={{ color: "var(--amber)", flexShrink: 0 }} />
                      <div style={{ flex: 1, minWidth: 0, fontSize: 13 }}>
                        <b style={{ fontWeight: 600 }}>{p.a_title || p.a}</b> ≈ <b style={{ fontWeight: 600 }}>{p.b_title || p.b}</b>
                        <div style={{ fontSize: 11.5, color: "var(--text-tertiary)" }}>same intent, different code — consider merging</div>
                      </div>
                      <span className="mono" style={{ fontSize: 11, color: "var(--amber)" }}>{(p.similarity * 100).toFixed(0)}%</span>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
