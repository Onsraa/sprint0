// GET /api/dashboard/summary?role=employee|manager|hr_admin
//
// Returns analytics aggregates, but only the slices the role is permitted to
// see — server-side enforcement of the RBAC matrix (mirrors @require_permission
// in dashboard/rbac.py). The client hides widgets too; this is defense in depth.

import { NextResponse } from 'next/server';

import { attritionRate, headcountByDepartment, utilization } from '@/lib/analytics';
import { getDataset } from '@/lib/data';
import { Permission, hasPermission, isRole } from '@/lib/rbac';

export function GET(request: Request) {
  const role = new URL(request.url).searchParams.get('role') ?? 'employee';
  if (!isRole(role)) {
    return NextResponse.json({ error: 'unknown role' }, { status: 400 });
  }

  const { referenceWeek } = getDataset();
  const start = new Date(`${referenceWeek.start}T00:00:00`);
  const end = new Date(`${referenceWeek.end}T23:59:59`);

  // Attrition window: the trailing ~6 months up to the reference week end.
  const attritionStart = new Date(end);
  attritionStart.setMonth(attritionStart.getMonth() - 6);

  const body: {
    role: string;
    permissions: string[];
    utilization?: ReturnType<typeof utilization>;
    headcount?: ReturnType<typeof headcountByDepartment>;
    attrition?: ReturnType<typeof attritionRate>;
  } = {
    role,
    permissions: [],
  };

  if (hasPermission(role, Permission.VIEW_TEAM_ANALYTICS)) {
    body.permissions.push(Permission.VIEW_TEAM_ANALYTICS);
    body.utilization = utilization(start, end);
  }

  if (hasPermission(role, Permission.VIEW_COMPANY_ANALYTICS)) {
    body.permissions.push(Permission.VIEW_COMPANY_ANALYTICS);
    body.headcount = headcountByDepartment(end);
    body.attrition = attritionRate(attritionStart, end);
  }

  return NextResponse.json(body);
}
