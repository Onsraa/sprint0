// Calendar page — weekly roster with shift-conflict detection.
//
// Renders the reference week's shifts in a grid, overlays pre-baked "proposed"
// shifts that the engine flags (double-booking + overtime + unavailable), and
// offers a form to check an ad-hoc proposed shift live. All detection runs in
// /api/schedule/conflicts via lib/scheduling.ts (port of scheduling/calendar.py).

'use client';

import { useEffect, useMemo, useState } from 'react';

import { Nav } from '@/components/Nav';

interface Shift {
  id: number;
  employee_id: number;
  starts_at: string;
  ends_at: string;
  role_label: string;
}

interface EmployeeRow {
  employee_id: number;
  name: string;
  shifts: Shift[];
}

interface Conflict {
  kind: 'double_booking' | 'overtime' | 'unavailable';
  employee_id: number;
  detail: string;
}

interface Proposal {
  employee_id: number;
  name: string;
  label: string;
  window: { start: string; end: string };
  conflicts: Conflict[];
}

interface ScheduleData {
  referenceWeek: { start: string; end: string };
  employees: EmployeeRow[];
  proposals: Proposal[];
}

interface CheckResult {
  name: string;
  proposed: { start: string; end: string };
  clear: boolean;
  conflicts: Conflict[];
}

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function dayIndex(iso: string, weekStart: string): number {
  const start = new Date(`${weekStart}T00:00:00`);
  const d = new Date(iso);
  const diff = Math.floor(
    (Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) -
      Date.UTC(start.getFullYear(), start.getMonth(), start.getDate())) /
      86_400_000
  );
  return diff;
}

function hhmm(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

const KIND_LABEL: Record<Conflict['kind'], string> = {
  double_booking: 'Double-booking',
  overtime: 'Overtime',
  unavailable: 'Unavailable',
};

export default function CalendarPage() {
  const [data, setData] = useState<ScheduleData | null>(null);

  useEffect(() => {
    fetch('/api/schedule/conflicts')
      .then((r) => r.json())
      .then(setData);
  }, []);

  if (!data) {
    return (
      <>
        <Nav />
        <p className="note">Loading roster…</p>
      </>
    );
  }

  // Index conflicted proposals so we can paint the grid cells red.
  const flaggedByEmpDay = new Map<string, Proposal>();
  for (const p of data.proposals) {
    if (p.conflicts.length > 0) {
      flaggedByEmpDay.set(`${p.employee_id}:${dayIndex(p.window.start, data.referenceWeek.start)}`, p);
    }
  }

  return (
    <>
      <Nav />
      <p className="subtitle">
        Weekly roster (week of {data.referenceWeek.start}). The scheduler checks
        every proposed shift for double-booking, weekly overtime (&gt;48h), and
        availability before it can be published.
      </p>

      <div className="grid-week">
        <div className="head" />
        {DAY_LABELS.map((d) => (
          <div className="head" key={d}>
            {d}
          </div>
        ))}

        {data.employees.map((emp) => (
          <Row
            key={emp.employee_id}
            emp={emp}
            weekStart={data.referenceWeek.start}
            flaggedByEmpDay={flaggedByEmpDay}
          />
        ))}
      </div>

      <div className="legend">
        <span>
          <span className="swatch" style={{ background: 'rgba(79,140,255,0.5)' }} />
          Scheduled shift
        </span>
        <span>
          <span className="swatch" style={{ background: 'rgba(255,107,107,0.55)' }} />
          Proposed shift with conflict
        </span>
      </div>

      <h2 className="section-title">Conflicts flagged in proposed shifts</h2>
      {data.proposals.map((p) => (
        <ProposalCard key={`${p.employee_id}-${p.window.start}`} proposal={p} />
      ))}

      <h2 className="section-title">Check a shift</h2>
      <CheckForm employees={data.employees} weekStart={data.referenceWeek.start} />
    </>
  );
}

function Row({
  emp,
  weekStart,
  flaggedByEmpDay,
}: {
  emp: EmployeeRow;
  weekStart: string;
  flaggedByEmpDay: Map<string, Proposal>;
}) {
  const cells: Shift[][] = Array.from({ length: 7 }, () => []);
  for (const s of emp.shifts) {
    const idx = dayIndex(s.starts_at, weekStart);
    if (idx >= 0 && idx < 7) cells[idx].push(s);
  }

  return (
    <>
      <div className="rowhead">{emp.name}</div>
      {cells.map((dayShifts, idx) => {
        const flagged = flaggedByEmpDay.get(`${emp.employee_id}:${idx}`);
        return (
          <div className="cell" key={idx}>
            {dayShifts.map((s) => (
              <span className="pill" key={s.id}>
                {hhmm(s.starts_at)}–{hhmm(s.ends_at)}
              </span>
            ))}
            {flagged && (
              <span
                className="pill conflict proposed"
                title={flagged.conflicts.map((c) => c.detail).join('; ')}
              >
                +{hhmm(flagged.window.start)}–{hhmm(flagged.window.end)} ⚠
              </span>
            )}
          </div>
        );
      })}
    </>
  );
}

function ProposalCard({ proposal }: { proposal: Proposal }) {
  const clear = proposal.conflicts.length === 0;
  return (
    <div className={`conflict-card ${clear ? 'clear' : ''}`}>
      <h3>
        {proposal.name} — {proposal.label}
      </h3>
      <p className="detail-line">
        Proposed {hhmm(proposal.window.start)}–{hhmm(proposal.window.end)} on{' '}
        {new Date(proposal.window.start).toLocaleDateString('en-US', {
          weekday: 'long',
        })}
      </p>
      {clear ? (
        <p className="detail-line">
          <span className="badge ok">clear</span> No conflicts — safe to publish.
        </p>
      ) : (
        proposal.conflicts.map((c, i) => (
          <p className="detail-line" key={i}>
            <span className={`badge ${c.kind}`}>{KIND_LABEL[c.kind]}</span>
            {c.detail}
          </p>
        ))
      )}
    </div>
  );
}

function CheckForm({
  employees,
  weekStart,
}: {
  employees: EmployeeRow[];
  weekStart: string;
}) {
  const defaults = useMemo(
    () => ({
      start: `${weekStart}T13:00`,
      end: `${weekStart}T18:00`,
    }),
    [weekStart]
  );

  const [employeeId, setEmployeeId] = useState(employees[0]?.employee_id ?? 1);
  const [start, setStart] = useState(defaults.start);
  const [end, setEnd] = useState(defaults.end);
  const [result, setResult] = useState<CheckResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const res = await fetch('/api/schedule/conflicts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        employee_id: Number(employeeId),
        start: new Date(start).toISOString(),
        end: new Date(end).toISOString(),
      }),
    });
    const body = await res.json();
    if (!res.ok) {
      setError(body.error ?? 'check failed');
      setResult(null);
      return;
    }
    setResult(body);
  }

  return (
    <form onSubmit={submit}>
      <p className="note" style={{ marginBottom: 12 }}>
        Pick an employee and a time window. Tip: try Chen Wei on{' '}
        {weekStart} 13:00–18:00 (overlaps an existing 09:00–17:00 shift) to force
        a double-booking.
      </p>
      <div className="cal-toolbar">
        <select
          value={employeeId}
          onChange={(e) => setEmployeeId(Number(e.target.value))}
          aria-label="Employee"
        >
          {employees.map((emp) => (
            <option key={emp.employee_id} value={emp.employee_id}>
              {emp.name}
            </option>
          ))}
        </select>
        <input
          type="datetime-local"
          value={start}
          onChange={(e) => setStart(e.target.value)}
          aria-label="Shift start"
        />
        <input
          type="datetime-local"
          value={end}
          onChange={(e) => setEnd(e.target.value)}
          aria-label="Shift end"
        />
        <button className="btn" type="submit">
          Check conflicts
        </button>
      </div>

      {error && (
        <div className="conflict-card">
          <p className="detail-line">{error}</p>
        </div>
      )}

      {result && (
        <div className={`conflict-card ${result.clear ? 'clear' : ''}`}>
          <h3>{result.name}</h3>
          {result.clear ? (
            <p className="detail-line">
              <span className="badge ok">clear</span> No conflicts — safe to
              publish.
            </p>
          ) : (
            result.conflicts.map((c, i) => (
              <p className="detail-line" key={i}>
                <span className={`badge ${c.kind}`}>{KIND_LABEL[c.kind]}</span>
                {c.detail}
              </p>
            ))
          )}
        </div>
      )}
    </form>
  );
}
