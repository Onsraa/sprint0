// Dashboard.tsx — Next.js role-based dashboard page.
//
// Fetches analytics from the Django API and renders only the widgets the
// viewer's role is allowed to see. Permission checks mirror dashboard/rbac.py;
// the API enforces them again server-side.

'use client';

import { useEffect, useState } from 'react';

type Role = 'employee' | 'manager' | 'hr_admin';

// Mirror of PERMISSIONS in dashboard/rbac.py (frontend hides; backend enforces).
const PERMISSIONS: Record<Role, string[]> = {
  employee: ['view_own_schedule'],
  manager: ['view_own_schedule', 'view_team_analytics', 'edit_schedule'],
  hr_admin: [
    'view_own_schedule',
    'view_team_analytics',
    'view_company_analytics',
    'edit_schedule',
    'manage_employees',
  ],
};

function can(role: Role, permission: string): boolean {
  return PERMISSIONS[role]?.includes(permission) ?? false;
}

interface DashboardData {
  headcount: { department: string; headcount: number }[];
  utilization: { name: string; utilization_pct: number }[];
  attrition: { attrition_pct: number };
}

export default function Dashboard({ role }: { role: Role }) {
  const [data, setData] = useState<DashboardData | null>(null);

  useEffect(() => {
    fetch('/api/dashboard/summary')
      .then((r) => r.json())
      .then(setData);
  }, []);

  if (!data) return <p>Loading dashboard…</p>;

  return (
    <main className="dashboard-grid">
      <MyScheduleWidget />

      {can(role, 'view_team_analytics') && (
        <Widget title="Team utilization">
          <ul>
            {data.utilization.map((u) => (
              <li key={u.name}>
                {u.name}: {u.utilization_pct}%
              </li>
            ))}
          </ul>
        </Widget>
      )}

      {can(role, 'view_company_analytics') && (
        <>
          <Widget title="Headcount by department">
            <ul>
              {data.headcount.map((h) => (
                <li key={h.department}>
                  {h.department}: {h.headcount}
                </li>
              ))}
            </ul>
          </Widget>
          <Widget title="Attrition">
            <p className="metric">{data.attrition.attrition_pct}%</p>
          </Widget>
        </>
      )}
    </main>
  );
}

function Widget({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="widget">
      <h2>{title}</h2>
      {children}
    </section>
  );
}

function MyScheduleWidget() {
  return (
    <section className="widget">
      <h2>My schedule</h2>
      <p>Your upcoming shifts appear here.</p>
    </section>
  );
}
