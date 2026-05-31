import { useState } from "react";
import type { WorkTask, TaskStatus } from "../../lib/api";
import { STATUS_COLUMNS, provenanceTag } from "./workUtils";
import { DISCIPLINE_COLOR, RISK_COLOR, DISCIPLINE_LABEL } from "../../lib/relayUtils";

/* Status sort order: planned, in_progress, in_review, done → blocked last */
const STATUS_ORDER: Record<TaskStatus, number> = {
  planned: 0,
  in_progress: 1,
  in_review: 2,
  done: 3,
  blocked: 4,
};

type SortKey = "title" | "status" | "assignee" | "est" | "discipline";
type SortDir = "asc" | "desc";

const STATUS_LABELS: Record<TaskStatus, string> = {
  planned: "Planned",
  in_progress: "In progress",
  in_review: "In review",
  done: "Done",
  blocked: "Blocked",
};

/* th styles */
const TH_BASE: React.CSSProperties = {
  textAlign: "left",
  fontSize: 11,
  fontWeight: 700,
  color: "var(--text-tertiary)",
  padding: "5px 8px",
  borderBottom: "1.5px solid var(--border)",
  whiteSpace: "nowrap",
  userSelect: "none",
  cursor: "pointer",
};

const TD_BASE: React.CSSProperties = {
  padding: "4px 8px",
  fontSize: 12,
  verticalAlign: "middle",
  borderBottom: "1px solid var(--border)",
};

export function WorkList({ tasks, onOpen }: { tasks: WorkTask[]; onOpen: (id: string) => void }) {
  const [sortKey, setSortKey] = useState<SortKey>("status");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [filterStatus, setFilterStatus] = useState<TaskStatus | "all">("all");
  const [filterText, setFilterText] = useState("");

  const handleHeaderClick = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  /* Filter */
  const filtered = tasks.filter((t) => {
    if (filterStatus !== "all" && t.status !== filterStatus) return false;
    if (filterText && !t.title.toLowerCase().includes(filterText.toLowerCase())) return false;
    return true;
  });

  /* Sort */
  const sorted = [...filtered].sort((a, b) => {
    let cmp = 0;
    switch (sortKey) {
      case "title":
        cmp = a.title.localeCompare(b.title);
        break;
      case "status":
        cmp = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
        if (cmp === 0) cmp = a.project_id - b.project_id;
        break;
      case "assignee":
        cmp = (a.assignee ?? "").localeCompare(b.assignee ?? "");
        break;
      case "est":
        cmp = (a.estimate_days ?? 0) - (b.estimate_days ?? 0);
        break;
      case "discipline":
        cmp = a.discipline.localeCompare(b.discipline);
        break;
    }
    return sortDir === "asc" ? cmp : -cmp;
  });

  const arrow = (key: SortKey) =>
    sortKey === key ? (sortDir === "asc" ? " ▲" : " ▼") : "";

  return (
    <div>
      {/* Toolbar */}
      <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 10 }}>
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value as TaskStatus | "all")}
          style={{
            fontSize: 12,
            padding: "3px 8px",
            border: "1px solid var(--border-strong)",
            borderRadius: 4,
            background: "var(--bg-elevated)",
            color: "var(--text-primary)",
            cursor: "pointer",
          }}
        >
          <option value="all">All statuses</option>
          {STATUS_COLUMNS.map((col) => (
            <option key={col.status} value={col.status}>{col.label}</option>
          ))}
          <option value="blocked">Blocked</option>
        </select>

        <input
          type="text"
          placeholder="Filter by title…"
          value={filterText}
          onChange={(e) => setFilterText(e.target.value)}
          style={{
            fontSize: 12,
            padding: "3px 8px",
            border: "1px solid var(--border-strong)",
            borderRadius: 4,
            background: "var(--bg-elevated)",
            color: "var(--text-primary)",
            width: 200,
          }}
        />

        <span className="mono" style={{ fontSize: 11, color: "var(--text-tertiary)", marginLeft: "auto" }}>
          {sorted.length} / {tasks.length}
        </span>
      </div>

      {/* Table */}
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr>
              {/* discipline dot — not sortable */}
              <th style={{ ...TH_BASE, width: 24, cursor: "default" }} />

              <th style={{ ...TH_BASE, width: 72 }} className="mono">id</th>

              <th style={{ ...TH_BASE }} onClick={() => handleHeaderClick("title")}>
                title{arrow("title")}
              </th>

              <th style={{ ...TH_BASE, width: 96 }} onClick={() => handleHeaderClick("status")}>
                status{arrow("status")}
              </th>

              <th style={{ ...TH_BASE, width: 110 }} onClick={() => handleHeaderClick("assignee")}>
                assignee{arrow("assignee")}
              </th>

              <th style={{ ...TH_BASE, width: 48 }} onClick={() => handleHeaderClick("est")}>
                est{arrow("est")}
              </th>

              <th style={{ ...TH_BASE, width: 60 }}>risk</th>

              <th style={{ ...TH_BASE, width: 80 }} onClick={() => handleHeaderClick("discipline")}>
                disc{arrow("discipline")}
              </th>

              <th style={{ ...TH_BASE, width: 60 }}>via</th>
            </tr>
          </thead>

          <tbody>
            {sorted.map((t) => (
              <TaskRow key={t.id} task={t} onOpen={onOpen} />
            ))}
            {sorted.length === 0 && (
              <tr>
                <td
                  colSpan={9}
                  style={{ ...TD_BASE, textAlign: "center", color: "var(--text-tertiary)", padding: "20px 8px" }}
                >
                  No tasks match.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ── Row ──────────────────────────────────────────────────────────────── */

function TaskRow({ task: t, onOpen }: { task: WorkTask; onOpen: (id: string) => void }) {
  const [hovered, setHovered] = useState(false);
  const discColor = DISCIPLINE_COLOR[t.discipline] ?? "var(--text-tertiary)";

  const rowStyle: React.CSSProperties = {
    cursor: "pointer",
    background: hovered ? "var(--bg-secondary)" : "transparent",
    transition: "background 0.1s",
  };

  /* Status chip colors */
  const statusChipStyle = (status: TaskStatus): React.CSSProperties => {
    if (status === "done") return { background: "var(--green)", borderColor: "var(--green)", color: "var(--bg-elevated)" };
    if (status === "blocked") return { background: "var(--text-primary)", borderColor: "var(--text-primary)", color: "var(--bg-elevated)", fontWeight: 700 };
    if (status === "in_progress") return { background: "var(--blue)", borderColor: "var(--blue)", color: "var(--bg-elevated)" };
    if (status === "in_review") return { background: "var(--amber)", borderColor: "var(--amber)", color: "var(--bg-elevated)" };
    return { background: "var(--bg-secondary)", borderColor: "var(--border-strong)", color: "var(--text-tertiary)" };
  };

  const muted = <span style={{ color: "var(--text-tertiary)" }}>—</span>;

  return (
    <tr
      style={rowStyle}
      onClick={() => onOpen(t.id)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Discipline dot */}
      <td style={{ ...TD_BASE, textAlign: "center" }}>
        <span
          title={DISCIPLINE_LABEL[t.discipline]}
          style={{
            display: "inline-block",
            width: 8,
            height: 8,
            borderRadius: 2,
            background: discColor,
            flexShrink: 0,
          }}
        />
      </td>

      {/* ID */}
      <td style={{ ...TD_BASE }}>
        <span className="mono" style={{ fontSize: 11, color: "var(--text-tertiary)" }}>{t.id}</span>
      </td>

      {/* Title */}
      <td style={{ ...TD_BASE, maxWidth: 320 }}>
        <span style={{ fontWeight: 600, lineHeight: 1.3 }}>{t.title}</span>
      </td>

      {/* Status */}
      <td style={{ ...TD_BASE }}>
        <span
          className="chip"
          style={{ fontSize: 10, padding: "1px 7px", ...statusChipStyle(t.status) }}
        >
          {STATUS_LABELS[t.status]}
        </span>
      </td>

      {/* Assignee */}
      <td style={{ ...TD_BASE }}>
        {t.redacted ? muted : (
          t.assignee
            ? <span className="mono" style={{ fontSize: 11, color: "var(--text-secondary)" }}>@{t.assignee}</span>
            : <span className="mono" style={{ fontSize: 11, color: "var(--text-tertiary)" }}>—</span>
        )}
      </td>

      {/* Estimate */}
      <td style={{ ...TD_BASE }}>
        {t.redacted ? muted : (
          t.estimate_days != null
            ? <span style={{ color: "var(--text-secondary)" }}>{t.estimate_days}d</span>
            : muted
        )}
      </td>

      {/* Risk */}
      <td style={{ ...TD_BASE }}>
        {t.redacted ? muted : (
          t.risk
            ? (
              <span
                className="chip"
                style={{
                  fontSize: 10,
                  padding: "1px 6px",
                  background: RISK_COLOR[t.risk],
                  borderColor: RISK_COLOR[t.risk],
                  color: "var(--bg-elevated)",
                }}
              >
                {t.risk}
              </span>
            )
            : muted
        )}
      </td>

      {/* Discipline label */}
      <td style={{ ...TD_BASE }}>
        <span className="kicker" style={{ fontSize: 10, color: discColor }}>
          {DISCIPLINE_LABEL[t.discipline]}
        </span>
      </td>

      {/* Provenance */}
      <td style={{ ...TD_BASE }}>
        {t.redacted ? muted : (
          t.assigned_by !== undefined
            ? (
              <span
                className="chip"
                style={{ fontSize: 10, padding: "1px 6px", background: "var(--bg-secondary)", color: "var(--text-tertiary)", borderColor: "var(--border-strong)" }}
              >
                {provenanceTag(t.assigned_by)}
              </span>
            )
            : muted
        )}
      </td>
    </tr>
  );
}
