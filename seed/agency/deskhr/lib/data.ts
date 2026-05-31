// data.ts — loads the bundled demo dataset (data/seed.json).
//
// In production this is Postgres via the Django ORM (see models/employee.py).
// For the runnable demo we read a bundled JSON file — zero database, zero keys.

import seed from '@/data/seed.json';

export type RoleName = 'employee' | 'manager' | 'hr_admin';

export interface Department {
  id: number;
  name: string;
}

export interface Employee {
  id: number;
  full_name: string;
  email: string;
  role: RoleName;
  department_id: number;
  manager_id: number | null;
  weekly_contract_hours: number;
  hired_at: string; // YYYY-MM-DD
  terminated_at: string | null; // YYYY-MM-DD | null
}

export interface Shift {
  id: number;
  employee_id: number;
  starts_at: string; // ISO datetime
  ends_at: string; // ISO datetime
  role_label: string;
}

export interface AvailabilityWindow {
  start: string;
  end: string;
}

export interface AvailabilityRecord {
  employee_id: number;
  windows: AvailabilityWindow[];
}

export interface Dataset {
  referenceWeek: { start: string; end: string };
  departments: Department[];
  employees: Employee[];
  shifts: Shift[];
  availability: AvailabilityRecord[];
}

const data = seed as unknown as Dataset;

export function getDataset(): Dataset {
  return data;
}

export function departmentName(id: number): string {
  return data.departments.find((d) => d.id === id)?.name ?? 'Unassigned';
}
