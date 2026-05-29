import { useState } from "react";
import type { WorkTask } from "../../lib/api";
import { provenanceTag } from "./workUtils";
import { DISCIPLINE_COLOR } from "../../lib/relayUtils";

/* ── Date helpers ────────────────────────────────────────────────────── */

const ms = (s: string) => new Date(s + "T00:00:00").getTime();
const DAY = 86400000;

function leftPct(start: string, minMs: number, spanMs: number): number {
  return ((ms(start) - minMs) / spanMs) * 100;
}

function widthPct(start: string, end: string, spanMs: number): number {
  return Math.max(2, ((ms(end) - ms(start)) + DAY) / spanMs * 100);
}

/* ── Bar ──────────────────────────────────────────────────────────────── */

function Bar({
  task: t,
  minMs,
  spanMs,
  onOpen,
}: {
  task: WorkTask;
  minMs: number;
  spanMs: number;
  onOpen: (id: string) => void;
}) {
  const color = DISCIPLINE_COLOR[t.discipline] ?? "var(--ink-mute)";
  const left = leftPct(t.scheduled_start!, minMs, spanMs);
  const width = widthPct(t.scheduled_start!, t.scheduled_end!, spanMs);

  return (
    <div style={{ position: "relative", height: 24 }}>
      <div
        onClick={() => onOpen(t.id)}
        title={`${t.title} · ${t.scheduled_start} → ${t.scheduled_end}`}
        style={{
          position: "absolute",
          left: `${left}%`,
          width: `${width}%`,
          top: 2,
          height: 20,
          background: color,
          borderRadius: 4,
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          gap: 4,
          paddingLeft: 5,
          paddingRight: 4,
          overflow: "hidden",
          boxSizing: "border-box",
        }}
      >
        <span
          style={{
            fontSize: 11,
            color: "var(--paper)",
            fontWeight: 600,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            flex: 1,
            minWidth: 0,
          }}
        >
          {t.title}
        </span>
        {t.assigned_by !== undefined && (
          <span
            style={{
              fontSize: 9,
              color: "rgba(255,255,255,0.75)",
              whiteSpace: "nowrap",
              flexShrink: 0,
            }}
          >
            {provenanceTag(t.assigned_by)}
          </span>
        )}
      </div>
    </div>
  );
}

/* ── Main component ───────────────────────────────────────────────────── */

export function WorkTimeline({
  tasks,
  onOpen,
}: {
  tasks: WorkTask[];
  onOpen: (id: string) => void;
}) {
  const [mode, setMode] = useState<"people" | "roadmap">("people");

  /* Filter to scheduled tasks only */
  const scheduled = tasks.filter((t) => t.scheduled_start && t.scheduled_end);
  const unscheduledCount = tasks.length - scheduled.length;

  if (scheduled.length === 0) {
    return (
      <div>
        <div
          className="card-soft"
          style={{
            padding: "24px 20px",
            textAlign: "center",
            color: "var(--ink-mute)",
            fontSize: 13,
          }}
        >
          No schedule computed yet for these tasks.
        </div>
      </div>
    );
  }

  /* Date scale */
  const minMs = Math.min(...scheduled.map((t) => ms(t.scheduled_start!)));
  const maxMs = Math.max(...scheduled.map((t) => ms(t.scheduled_end!)));
  const spanMs = Math.max(DAY, (maxMs - minMs) + DAY);

  /* Today line */
  const todayMs = Date.now();
  const todayPct = ((todayMs - minMs) / spanMs) * 100;
  const showToday = todayPct >= 0 && todayPct <= 100;

  /* Weekly tick marks */
  const ticks: { ms: number; label: string }[] = [];
  {
    // round first tick down to nearest Monday
    let t = minMs;
    const d = new Date(t);
    const dow = d.getDay(); // 0=Sun
    const daysBack = dow === 0 ? 0 : dow;
    t -= daysBack * DAY;
    while (t <= maxMs + DAY) {
      const d2 = new Date(t);
      ticks.push({ ms: t, label: `${d2.getMonth() + 1}/${d2.getDate()}` });
      t += 7 * DAY;
    }
  }

  function tickLeft(tickMs: number): number {
    return ((tickMs - minMs) / spanMs) * 100;
  }

  /* Group into lanes */
  type Lane = { key: string; label: string; tasks: WorkTask[] };
  const laneMap = new Map<string, Lane>();

  for (const t of scheduled) {
    const key =
      mode === "people"
        ? (t.assignee ?? "unassigned")
        : String(t.project_id);
    const label =
      mode === "people"
        ? (t.assignee ?? "unassigned")
        : `#${t.project_id}`;
    if (!laneMap.has(key)) laneMap.set(key, { key, label, tasks: [] });
    laneMap.get(key)!.tasks.push(t);
  }

  const lanes: Lane[] = Array.from(laneMap.values()).map((lane) => ({
    ...lane,
    tasks: [...lane.tasks].sort((a, b) =>
      ms(a.scheduled_start!) - ms(b.scheduled_start!)
    ),
  }));

  const LABEL_W = 140;

  return (
    <div>
      {/* Mode toggle chips */}
      <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
        {(["people", "roadmap"] as const).map((m) => (
          <button
            key={m}
            className="chip"
            onClick={() => setMode(m)}
            style={{
              fontSize: 11,
              padding: "3px 10px",
              cursor: "pointer",
              background: mode === m ? "var(--ink)" : "var(--cream-deep)",
              color: mode === m ? "var(--paper)" : "var(--ink-soft)",
              borderColor: mode === m ? "var(--ink)" : "var(--line-strong)",
              fontWeight: mode === m ? 700 : 400,
              border: "1px solid",
              borderRadius: 99,
              lineHeight: 1.6,
            }}
          >
            {m === "people" ? "People" : "Roadmap"}
          </button>
        ))}
      </div>

      {/* Gantt grid */}
      <div
        className="card-soft"
        style={{ padding: "12px 12px 8px", overflowX: "auto" }}
      >
        <div style={{ minWidth: 600 }}>
          {/* Axis row */}
          <div
            style={{
              display: "flex",
              marginBottom: 4,
              borderBottom: "1px solid var(--line)",
              paddingBottom: 4,
            }}
          >
            {/* Spacer */}
            <div style={{ width: LABEL_W, flexShrink: 0 }} />
            {/* Tick track */}
            <div style={{ flex: 1, position: "relative", height: 18 }}>
              {ticks.map((tick) => {
                const pct = tickLeft(tick.ms);
                if (pct < 0 || pct > 100) return null;
                return (
                  <span
                    key={tick.ms}
                    style={{
                      position: "absolute",
                      left: `${pct}%`,
                      top: 0,
                      fontSize: 10,
                      fontFamily: "var(--font-mono, monospace)",
                      color: "var(--ink-mute)",
                      transform: "translateX(-50%)",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {tick.label}
                  </span>
                );
              })}
            </div>
          </div>

          {/* Lanes */}
          {lanes.map((lane, laneIdx) => (
            <div
              key={lane.key}
              style={{
                borderBottom:
                  laneIdx < lanes.length - 1
                    ? "1px solid var(--line)"
                    : "none",
                marginBottom: 2,
                paddingBottom: 4,
              }}
            >
              {lane.tasks.map((task, taskIdx) => (
                <div
                  key={task.id}
                  style={{ display: "flex", alignItems: "center" }}
                >
                  {/* Label cell — only shown for first task in lane */}
                  <div
                    style={{
                      width: LABEL_W,
                      flexShrink: 0,
                      paddingRight: 8,
                      display: "flex",
                      alignItems: "center",
                    }}
                  >
                    {taskIdx === 0 && (
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 700,
                          color: "var(--ink-soft)",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                          maxWidth: LABEL_W - 8,
                        }}
                      >
                        {lane.label}
                      </span>
                    )}
                  </div>

                  {/* Track */}
                  <div style={{ flex: 1, position: "relative" }}>
                    {/* Vertical gridlines from ticks */}
                    {ticks.map((tick) => {
                      const pct = tickLeft(tick.ms);
                      if (pct < 0 || pct > 100) return null;
                      return (
                        <div
                          key={tick.ms}
                          style={{
                            position: "absolute",
                            left: `${pct}%`,
                            top: 0,
                            bottom: 0,
                            width: 1,
                            background: "var(--line)",
                            pointerEvents: "none",
                          }}
                        />
                      );
                    })}

                    {/* Today line */}
                    {showToday && (
                      <div
                        style={{
                          position: "absolute",
                          left: `${todayPct}%`,
                          top: 0,
                          bottom: 0,
                          width: 2,
                          background: "var(--orange)",
                          pointerEvents: "none",
                          zIndex: 2,
                        }}
                        title="today"
                      />
                    )}

                    <Bar
                      task={task}
                      minMs={minMs}
                      spanMs={spanMs}
                      onOpen={onOpen}
                    />
                  </div>
                </div>
              ))}
            </div>
          ))}

          {/* Today label (below lanes) */}
          {showToday && (
            <div
              style={{
                display: "flex",
                marginTop: 4,
              }}
            >
              <div style={{ width: LABEL_W, flexShrink: 0 }} />
              <div style={{ flex: 1, position: "relative", height: 14 }}>
                <span
                  style={{
                    position: "absolute",
                    left: `${todayPct}%`,
                    transform: "translateX(-50%)",
                    fontSize: 9,
                    color: "var(--orange)",
                    fontWeight: 600,
                    whiteSpace: "nowrap",
                    fontFamily: "var(--font-mono, monospace)",
                  }}
                >
                  today
                </span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Unscheduled footer */}
      {unscheduledCount > 0 && (
        <div
          style={{
            marginTop: 8,
            fontSize: 11,
            color: "var(--ink-mute)",
            paddingLeft: 2,
          }}
        >
          {unscheduledCount} unscheduled
        </div>
      )}
    </div>
  );
}
