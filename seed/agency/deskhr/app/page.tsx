// Dashboard page — role-gated workforce analytics.
//
// Reworked from web/Dashboard.tsx: same RBAC-gated widget pattern, now driven by
// a live role switcher and rendering analytics as charts. The API
// (/api/dashboard/summary) only returns slices the role may see; the client also
// hides widgets via the PERMISSIONS matrix — defense in depth, per dashboard/rbac.py.

'use client';

import { useEffect, useState } from 'react';

import { BarChart } from '@/components/BarChart';
import { Nav } from '@/components/Nav';
import type { RoleName } from '@/lib/data';
import { Permission, ROLES, hasPermission } from '@/lib/rbac';

interface SummaryData {
  role: RoleName;
  permissions: string[];
  utilization?: { name: string; utilization_pct: number; scheduled_hours: number; capacity_hours: number }[];
  headcount?: { department: string; headcount: number }[];
  attrition?: { attrition_pct: number; leavers: number; avg_headcount: number };
}

export default function DashboardPage() {
  const [role, setRole] = useState<RoleName>('manager');
  const [data, setData] = useState<SummaryData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    fetch(`/api/dashboard/summary?role=${role}`)
      .then((r) => r.json())
      .then((d) => {
        if (active) {
          setData(d);
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [role]);

  const canTeam = hasPermission(role, Permission.VIEW_TEAM_ANALYTICS);
  const canCompany = hasPermission(role, Permission.VIEW_COMPANY_ANALYTICS);

  return (
    <>
      <Nav />
      <p className="subtitle">
        Role-based dashboard. Switch the viewer role to watch analytics widgets
        appear and disappear — gating is enforced both in the API and the UI.
      </p>

      <div className="rolebar">
        <span className="label">Viewing as</span>
        <div className="role-switch" role="group" aria-label="Select viewer role">
          {ROLES.map((r) => (
            <button
              key={r.value}
              className={role === r.value ? 'active' : ''}
              onClick={() => setRole(r.value)}
            >
              {r.label}
            </button>
          ))}
        </div>
        <div className="perm-chips">
          {(data?.permissions ?? []).map((p) => (
            <span className="chip" key={p}>
              {p}
            </span>
          ))}
        </div>
      </div>

      <main className="dashboard-grid">
        {/* Everyone can see their own schedule. */}
        <MyScheduleWidget />

        {/* Manager+ : team utilization */}
        {canTeam ? (
          <section className="widget">
            <h2>Team utilization</h2>
            <p className="hint">
              Scheduled hours / contracted capacity, this week. Bars over 100%
              are flagged in red (over-utilized).
            </p>
            {loading || !data?.utilization ? (
              <p className="note">Loading…</p>
            ) : (
              <BarChart
                data={data.utilization.map((u) => ({
                  label: u.name,
                  value: u.utilization_pct,
                }))}
                max={Math.max(100, ...data.utilization.map((u) => u.utilization_pct))}
                format={(v) => `${v}%`}
                colorFor={(v) => (v > 100 ? 'var(--danger)' : 'var(--accent-2)')}
              />
            )}
          </section>
        ) : (
          <LockedWidget
            title="Team utilization"
            need="view_team_analytics (Manager+)"
          />
        )}

        {/* HR Admin : headcount by department */}
        {canCompany ? (
          <section className="widget">
            <h2>Headcount by department</h2>
            <p className="hint">Active employees per department, company-wide.</p>
            {loading || !data?.headcount ? (
              <p className="note">Loading…</p>
            ) : (
              <BarChart
                data={data.headcount.map((h) => ({
                  label: h.department,
                  value: h.headcount,
                }))}
                format={(v) => String(v)}
              />
            )}
          </section>
        ) : (
          <LockedWidget
            title="Headcount by department"
            need="view_company_analytics (HR Admin)"
          />
        )}

        {/* HR Admin : attrition */}
        {canCompany ? (
          <section className="widget">
            <h2>Attrition (trailing 6 months)</h2>
            <p className="hint">Leavers over average headcount.</p>
            {loading || !data?.attrition ? (
              <p className="note">Loading…</p>
            ) : (
              <>
                <p className="metric">{data.attrition.attrition_pct}%</p>
                <p className="metric-sub">
                  {data.attrition.leavers} leaver
                  {data.attrition.leavers === 1 ? '' : 's'} · avg headcount{' '}
                  {data.attrition.avg_headcount}
                </p>
              </>
            )}
          </section>
        ) : (
          <LockedWidget
            title="Attrition"
            need="view_company_analytics (HR Admin)"
          />
        )}
      </main>
    </>
  );
}

function MyScheduleWidget() {
  return (
    <section className="widget">
      <h2>My schedule</h2>
      <p className="hint">Visible to every role.</p>
      <ul className="schedule-list">
        <li>
          <span>Mon 09:00–17:00</span>
          <span className="role-label">Support desk</span>
        </li>
        <li>
          <span>Wed 09:00–17:00</span>
          <span className="role-label">Support desk</span>
        </li>
        <li>
          <span>Fri 13:00–17:00</span>
          <span className="role-label">On-call</span>
        </li>
      </ul>
    </section>
  );
}

function LockedWidget({ title, need }: { title: string; need: string }) {
  return (
    <section className="widget">
      <h2>{title}</h2>
      <div className="locked">
        <span aria-hidden>🔒</span>
        <span>Requires {need}. Hidden for this role.</span>
      </div>
    </section>
  );
}
