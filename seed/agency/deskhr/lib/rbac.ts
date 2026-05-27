// rbac.ts — role-based access control.
//
// Direct port of dashboard/rbac.py. The same PERMISSIONS matrix gates both the
// API routes (server-side enforcement) and the dashboard widgets (client-side
// hiding) — defense in depth, exactly as the Python reference describes.

import type { RoleName } from '@/lib/data';

export const Permission = {
  VIEW_OWN_SCHEDULE: 'view_own_schedule',
  VIEW_TEAM_ANALYTICS: 'view_team_analytics',
  VIEW_COMPANY_ANALYTICS: 'view_company_analytics',
  EDIT_SCHEDULE: 'edit_schedule',
  MANAGE_EMPLOYEES: 'manage_employees',
} as const;

export type PermissionName = (typeof Permission)[keyof typeof Permission];

// Role -> permissions. Higher roles are supersets, kept explicit for clarity.
export const PERMISSIONS: Record<RoleName, PermissionName[]> = {
  employee: [Permission.VIEW_OWN_SCHEDULE],
  manager: [
    Permission.VIEW_OWN_SCHEDULE,
    Permission.VIEW_TEAM_ANALYTICS,
    Permission.EDIT_SCHEDULE,
  ],
  hr_admin: [
    Permission.VIEW_OWN_SCHEDULE,
    Permission.VIEW_TEAM_ANALYTICS,
    Permission.VIEW_COMPANY_ANALYTICS,
    Permission.EDIT_SCHEDULE,
    Permission.MANAGE_EMPLOYEES,
  ],
};

export function hasPermission(role: RoleName, permission: PermissionName): boolean {
  return PERMISSIONS[role]?.includes(permission) ?? false;
}

export const ROLES: { value: RoleName; label: string }[] = [
  { value: 'employee', label: 'Employee' },
  { value: 'manager', label: 'Manager' },
  { value: 'hr_admin', label: 'HR Admin' },
];

export function isRole(value: string | null): value is RoleName {
  return value === 'employee' || value === 'manager' || value === 'hr_admin';
}
