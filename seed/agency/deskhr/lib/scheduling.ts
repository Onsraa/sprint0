// scheduling.ts — shift scheduling conflict engine.
//
// Port of scheduling/calendar.py. Validates a proposed shift against existing
// assignments before publish: double-booking (overlap), weekly-overtime breach,
// and out-of-availability. Same three checks, same 48h overtime cap.

export const MAX_WEEKLY_HOURS = 48.0; // overtime threshold

export interface TimeWindow {
  start: string; // ISO datetime
  end: string; // ISO datetime
}

export interface AvailabilityWindows {
  windows: TimeWindow[];
}

export type ConflictKind = 'double_booking' | 'overtime' | 'unavailable';

export interface Conflict {
  kind: ConflictKind;
  employee_id: number;
  detail: string;
}

function ms(w: TimeWindow): { start: number; end: number } {
  return { start: new Date(w.start).getTime(), end: new Date(w.end).getTime() };
}

export function windowHours(w: TimeWindow): number {
  const { start, end } = ms(w);
  return (end - start) / 3_600_000;
}

/** True if two windows intersect (port of TimeWindow.overlaps). */
export function overlaps(a: TimeWindow, b: TimeWindow): boolean {
  const x = ms(a);
  const y = ms(b);
  return x.start < y.end && y.start < x.end;
}

/** True if the shift fits entirely inside one availability window. */
export function canCover(avail: AvailabilityWindows, shift: TimeWindow): boolean {
  const s = ms(shift);
  return avail.windows.some((w) => {
    const win = ms(w);
    return win.start <= s.start && s.end <= win.end;
  });
}

/**
 * ISO-8601 week key (year-week) for the date — used to bucket a week's hours,
 * mirroring Python's `datetime.isocalendar()[:2]`.
 */
function isoWeekKey(d: Date): string {
  // Copy date, shift to nearest Thursday (ISO weeks are Thursday-anchored).
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = (date.getUTCDay() + 6) % 7; // Mon=0 .. Sun=6
  date.setUTCDate(date.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  const firstDayNum = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNum + 3);
  const week =
    1 + Math.round((date.getTime() - firstThursday.getTime()) / (7 * 24 * 3600 * 1000));
  return `${date.getUTCFullYear()}-W${week}`;
}

/** Total hours already scheduled in the ISO week containing `when`. */
function weekHours(when: string, shifts: TimeWindow[]): number {
  const targetKey = isoWeekKey(new Date(when));
  return shifts
    .filter((s) => isoWeekKey(new Date(s.start)) === targetKey)
    .reduce((sum, s) => sum + windowHours(s), 0);
}

/** Validate a single proposed shift against current state (port of detect_conflicts). */
export function detectConflicts(
  employeeId: number,
  proposed: TimeWindow,
  existing: TimeWindow[],
  availability?: AvailabilityWindows
): Conflict[] {
  const conflicts: Conflict[] = [];

  // 1. Double-booking: overlaps an already-assigned shift.
  for (const shift of existing) {
    if (overlaps(proposed, shift)) {
      conflicts.push({
        kind: 'double_booking',
        employee_id: employeeId,
        detail: `overlaps ${formatStamp(shift.start)}`,
      });
      break;
    }
  }

  // 2. Overtime: would push the ISO-week total over the cap.
  const total = weekHours(proposed.start, existing) + windowHours(proposed);
  if (total > MAX_WEEKLY_HOURS) {
    conflicts.push({
      kind: 'overtime',
      employee_id: employeeId,
      detail: `week total ${total.toFixed(1)}h > ${MAX_WEEKLY_HOURS}h`,
    });
  }

  // 3. Availability: outside any declared availability window.
  if (availability && !canCover(availability, proposed)) {
    conflicts.push({
      kind: 'unavailable',
      employee_id: employeeId,
      detail: 'outside availability',
    });
  }

  return conflicts;
}

/** Assign the shift only when there are zero conflicts (port of assign_if_clear). */
export function assignIfClear(
  employeeId: number,
  proposed: TimeWindow,
  existing: TimeWindow[],
  availability?: AvailabilityWindows
): { assigned: boolean; conflicts: Conflict[] } {
  const conflicts = detectConflicts(employeeId, proposed, existing, availability);
  if (conflicts.length > 0) return { assigned: false, conflicts };
  existing.push(proposed);
  return { assigned: true, conflicts: [] };
}

function formatStamp(iso: string): string {
  const d = new Date(iso);
  const day = d.toLocaleDateString('en-US', { weekday: 'short' });
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${day} ${hh}:${mm}`;
}
