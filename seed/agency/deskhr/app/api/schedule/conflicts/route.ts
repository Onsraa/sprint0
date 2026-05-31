// /api/schedule/conflicts
//
//   GET  -> the reference week's shifts grouped by employee, plus a set of
//           pre-baked "proposed" shifts run through the conflict engine so the
//           calendar shows a flagged double-booking + overtime on first load.
//   POST -> { employee_id, start, end } -> conflicts for an ad-hoc proposed shift,
//           checked against that employee's existing shifts + availability.
//
// All detection uses lib/scheduling.ts (port of scheduling/calendar.py).

import { NextResponse } from 'next/server';

import { getDataset, type Shift } from '@/lib/data';
import {
  detectConflicts,
  type AvailabilityWindows,
  type Conflict,
  type TimeWindow,
} from '@/lib/scheduling';

function existingFor(employeeId: number): TimeWindow[] {
  return getDataset()
    .shifts.filter((s) => s.employee_id === employeeId)
    .map((s) => ({ start: s.starts_at, end: s.ends_at }));
}

function availabilityFor(employeeId: number): AvailabilityWindows | undefined {
  const rec = getDataset().availability.find((a) => a.employee_id === employeeId);
  return rec ? { windows: rec.windows } : undefined;
}

function employeeName(employeeId: number): string {
  return (
    getDataset().employees.find((e) => e.id === employeeId)?.full_name ??
    `#${employeeId}`
  );
}

// Pre-baked proposals that demonstrate each conflict type on page load.
//  - Chen Wei (3): a Tue 13:00–18:00 shift that OVERLAPS the existing 09:00–17:00 -> double_booking.
//  - Ezra Whitfield (5): a Sat 06:00–16:00 shift on top of an already 50h week -> overtime.
//  - Dolores Reyes (4): a Tue 19:00–22:00 shift outside her availability -> unavailable.
const PROPOSALS: { employee_id: number; label: string; window: TimeWindow }[] = [
  {
    employee_id: 3,
    label: 'Add Tue afternoon cover',
    window: { start: '2026-05-26T13:00:00', end: '2026-05-26T18:00:00' },
  },
  {
    employee_id: 5,
    label: 'Add Sat ops shift',
    window: { start: '2026-05-30T06:00:00', end: '2026-05-30T16:00:00' },
  },
  {
    employee_id: 4,
    label: 'Add Tue evening cover',
    window: { start: '2026-05-26T19:00:00', end: '2026-05-26T22:00:00' },
  },
];

export function GET() {
  const data = getDataset();

  const byEmployee = data.employees
    .filter((e) => e.terminated_at === null)
    .map((emp) => ({
      employee_id: emp.id,
      name: emp.full_name,
      department_id: emp.department_id,
      shifts: data.shifts
        .filter((s: Shift) => s.employee_id === emp.id)
        .sort((a, b) => a.starts_at.localeCompare(b.starts_at)),
    }));

  const proposals = PROPOSALS.map((p) => ({
    employee_id: p.employee_id,
    name: employeeName(p.employee_id),
    label: p.label,
    window: p.window,
    conflicts: detectConflicts(
      p.employee_id,
      p.window,
      existingFor(p.employee_id),
      availabilityFor(p.employee_id)
    ),
  }));

  return NextResponse.json({
    referenceWeek: data.referenceWeek,
    employees: byEmployee,
    proposals,
  });
}

export async function POST(request: Request) {
  let payload: { employee_id?: number; start?: string; end?: string };
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  const { employee_id, start, end } = payload;
  if (typeof employee_id !== 'number' || !start || !end) {
    return NextResponse.json(
      { error: 'employee_id (number), start, and end are required' },
      { status: 400 }
    );
  }
  if (new Date(end).getTime() <= new Date(start).getTime()) {
    return NextResponse.json({ error: 'end must be after start' }, { status: 400 });
  }

  const proposed: TimeWindow = { start, end };
  const conflicts: Conflict[] = detectConflicts(
    employee_id,
    proposed,
    existingFor(employee_id),
    availabilityFor(employee_id)
  );

  return NextResponse.json({
    employee_id,
    name: employeeName(employee_id),
    proposed,
    clear: conflicts.length === 0,
    conflicts,
  });
}
