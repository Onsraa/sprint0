// analytics.ts — headcount, utilization, and attrition aggregates.
//
// Port of dashboard/analytics.py. Pure read-side functions over the bundled
// employee/shift dataset; each returns plain objects the dashboard renders as
// charts. The aggregation approach mirrors the Django ORM version one-for-one.

import { departmentName, getDataset, type Dataset } from '@/lib/data';

const DAY_MS = 24 * 60 * 60 * 1000;

function asDate(d: string): Date {
  // Parse YYYY-MM-DD as a date (midnight) for inclusive day comparisons.
  return new Date(`${d}T00:00:00`);
}

function durationHours(startsAt: string, endsAt: string): number {
  return (new Date(endsAt).getTime() - new Date(startsAt).getTime()) / 3_600_000;
}

function isActiveAsOf(emp: Dataset['employees'][number], asOf: Date): boolean {
  if (asDate(emp.hired_at).getTime() > asOf.getTime()) return false;
  if (emp.terminated_at === null) return true;
  return asDate(emp.terminated_at).getTime() > asOf.getTime();
}

export interface HeadcountRow {
  department: string;
  headcount: number;
}

/** Active headcount grouped by department (port of headcount_by_department). */
export function headcountByDepartment(asOf?: Date): HeadcountRow[] {
  const data = getDataset();
  const ref = asOf ?? asDate(data.referenceWeek.end);
  const counts = new Map<string, number>();

  for (const emp of data.employees) {
    if (!isActiveAsOf(emp, ref)) continue;
    const dept = departmentName(emp.department_id);
    counts.set(dept, (counts.get(dept) ?? 0) + 1);
  }

  return [...counts.entries()]
    .map(([department, headcount]) => ({ department, headcount }))
    .sort((a, b) => b.headcount - a.headcount);
}

export interface UtilizationRow {
  employee_id: number;
  name: string;
  scheduled_hours: number;
  capacity_hours: number;
  utilization_pct: number;
}

/**
 * Scheduled hours vs contracted hours per employee over a window
 * (port of utilization). utilization = scheduled / (contract * weeks).
 */
export function utilization(start: Date, end: Date): UtilizationRow[] {
  const data = getDataset();
  const weeks = Math.max((end.getTime() - start.getTime()) / DAY_MS / 7, 0.1);
  const results: UtilizationRow[] = [];

  for (const emp of data.employees) {
    if (emp.terminated_at !== null) continue;

    const totalHours = data.shifts
      .filter(
        (s) =>
          s.employee_id === emp.id &&
          new Date(s.starts_at).getTime() >= start.getTime() &&
          new Date(s.ends_at).getTime() <= end.getTime()
      )
      .reduce((sum, s) => sum + durationHours(s.starts_at, s.ends_at), 0);

    const capacity = emp.weekly_contract_hours * weeks;
    results.push({
      employee_id: emp.id,
      name: emp.full_name,
      scheduled_hours: round1(totalHours),
      capacity_hours: round1(capacity),
      utilization_pct: capacity ? round1((100 * totalHours) / capacity) : 0,
    });
  }

  return results.sort((a, b) => b.utilization_pct - a.utilization_pct);
}

export interface AttritionResult {
  leavers: number;
  avg_headcount: number;
  attrition_pct: number;
}

/** Terminations over average headcount in the window (port of attrition_rate). */
export function attritionRate(start: Date, end: Date): AttritionResult {
  const data = getDataset();

  const leavers = data.employees.filter((e) => {
    if (e.terminated_at === null) return false;
    const t = asDate(e.terminated_at).getTime();
    return t >= start.getTime() && t <= end.getTime();
  }).length;

  const startCount = data.employees.filter((e) => isActiveAsOf(e, start)).length;
  const endCount = data.employees.filter((e) => isActiveAsOf(e, end)).length;
  const avgHeadcount = Math.max((startCount + endCount) / 2, 1);

  return {
    leavers,
    avg_headcount: round1(avgHeadcount),
    attrition_pct: round1((100 * leavers) / avgHeadcount),
  };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
