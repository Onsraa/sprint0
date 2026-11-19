/* sprint0 — Reuse lineage (Living Project Graph). A reused feature is ONE content-addressed node; the
 * projects that reused it are `derived_from` edges, NOT copies. Every canonical feature renders as its
 * own card (live dispatches add features beyond the seed). "Simulate source change" = the event a
 * GitLab merge webhook would post → propose a sync task in every dependent (the owner ratifies; nothing
 * auto-applies). Reads the live "lineage" graph; reuses the work + inbox queries so the bell/board update. */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "../lib/api";
import type { GraphNode } from "../lib/api";
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
  const byPath = new Map(nodes.map((n) => [n.path, n]));
  const depsOf = (path: string) =>
    derived.filter((e) => e.to_path === path).map((e) => byPath.get(e.from_path)).filter(Boolean) as GraphNode[];
  // every canonical content-addressed feature (no ref_project_id), most-reused first — the seeded story leads
  const features = nodes
    .filter((n) => n.node_type === "feature" && !n.ref_project_id)
    .sort((a, b) => depsOf(b.path).length - depsOf(a.path).length);

  const sim = useMutation({
    // copy derives from the feature itself — what a merge webhook on ITS source repo would post
    mutationFn: (f: GraphNode) => api.simulateSourceChange({
      feature_node: f.path, new_hash: `${f.content_hash || f.path}-next`,
      summary: `Upstream change to ${f.title || f.path}`,
    }),
    onSuccess: (res) => {
      toast.success(`Proposed ${res.dependents} sync task${res.dependents === 1 ? "" : "s"}`,
        { description: "Each dependent's owner ratifies — nothing auto-applies." });
      qc.invalidateQueries({ queryKey: ["work"] });   // the planned sync tasks land in the work hub
      qc.invalidateQueries({ queryKey: qk.inbox() });  // the owner's bell pings
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Simulate failed"),
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
          {!isLoading && features.length === 0 && <div style={{ color: "var(--text-tertiary)", fontSize: 13 }}>No reuse lineage seeded.</div>}

          {features.map((f) => {
            const deps = depsOf(f.path);
            // copies = other canonical nodes carrying the SAME content hash — content-addressing makes this
            // 0 by construction; computed (not hardcoded) so the claim stays honest if dedup ever regresses.
            const copies = features.filter((o) => o.path !== f.path && o.content_hash && o.content_hash === f.content_hash).length;
            return (
              <div key={f.path} style={{ border: "0.5px solid var(--border)", borderRadius: "var(--r-lg)", padding: 18, background: "var(--bg-elevated)", marginBottom: 18 }}>
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
                  <div style={{ minWidth: 0 }}>
                    <div className="kicker" style={{ marginBottom: 6 }}>Reused feature</div>
                    <div style={{ fontSize: 16, fontWeight: 600, letterSpacing: "-0.2px" }}>{f.title || f.path}</div>
                    <div className="mono" style={{ fontSize: 12, color: "var(--text-tertiary)", marginTop: 4 }}>{f.content_hash || f.path}</div>
                  </div>
                  <div style={{ flexShrink: 0, textAlign: "center", border: "0.5px solid var(--border)", borderRadius: "var(--r-md)", padding: "8px 14px", background: "var(--bg-secondary)" }}>
                    <div className="mono" style={{ fontSize: 22, fontWeight: 600, letterSpacing: "-1px" }}>{deps.length}</div>
                    <div style={{ fontSize: 10.5, color: "var(--text-tertiary)", marginTop: 2 }}>reuse{deps.length === 1 ? "" : "s"} · {copies} cop{copies === 1 ? "y" : "ies"}</div>
                  </div>
                </div>

                {deps.length > 0 && (
                  <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 8 }}>
                    {deps.map((d) => (
                      <div key={d.path} style={{ display: "flex", alignItems: "center", gap: 10, border: "0.5px solid var(--border)", borderRadius: "var(--r-md)", padding: "11px 14px", background: "var(--bg-secondary)" }}>
                        <Icon name="merges" size={14} style={{ color: "var(--text-tertiary)", flexShrink: 0 }} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13.5, fontWeight: 500 }}>{d.title || d.path} <span style={{ color: "var(--text-tertiary)", fontWeight: 400 }}>reused this</span></div>
                          <div className="mono" style={{ fontSize: 11, color: "var(--text-quaternary)" }}>{d.content_hash || "—"}</div>
                        </div>
                        <span className="mono" style={{ fontSize: 11, color: "var(--text-tertiary)", background: "var(--bg-elevated)", border: "0.5px solid var(--border)", borderRadius: 4, padding: "2px 6px" }}>{d.domain}</span>
                      </div>
                    ))}
                  </div>
                )}

                {role === "manager" && deps.length > 0 && (
                  <div style={{ marginTop: 16, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                    <Button variant="primary" size="md" icon="bolt" disabled={sim.isPending} onClick={() => sim.mutate(f)}>
                      {sim.isPending && sim.variables?.path === f.path ? "Propagating…" : "Simulate source change"}
                    </Button>
                    <span style={{ fontSize: 12, color: "var(--text-tertiary)" }}>proposes a sync task in each dependent — the owner ratifies</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
