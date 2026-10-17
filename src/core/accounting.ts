import type { ActivePeriod, Project, TimeRecord, WeekReport } from '../shared.js';
import { AppFailure } from './errors.js';

export function dayStart(at: number): number {
  const day = new Date(at);
  day.setHours(0, 0, 0, 0);
  return day.getTime();
}
export function addLocalDays(at: number, count: number): number {
  const day = new Date(at);
  day.setDate(day.getDate() + count);
  return day.getTime();
}
export function overlapMs(start: number, end: number, rangeStart: number, rangeEnd: number): number {
  return Math.max(0, Math.min(end, rangeEnd) - Math.max(start, rangeStart));
}
/** All views use the same intervals and add milliseconds before display formatting. */
export function accounting(records: readonly TimeRecord[], active: ActivePeriod | null, projects: readonly Project[], now: number, weekOffset = 0): { todayMs: number; week: WeekReport } {
  if (!Number.isSafeInteger(weekOffset)) throw new AppFailure('INVALID_RANGE');
  const today = dayStart(now);
  const monday = addLocalDays(today, -((new Date(today).getDay() + 6) % 7) + weekOffset * 7);
  const days = Array.from({ length: 8 }, (_, index) => addLocalDays(monday, index));
  if (days.some(value => !Number.isFinite(value))) throw new AppFailure('INVALID_RANGE');
  const rows = projects.map(project => ({ projectId: project.id, name: project.name, archived: project.archived, days: Array<number>(7).fill(0), total: 0 }));
  const byProject = new Map(rows.map(row => [row.projectId, row]));
  const workDays = Array<number>(7).fill(0);
  const breakDays = Array<number>(7).fill(0);
  const intervals = active ? [...records, { ...active, end: Math.max(active.start, now) }] : records;
  let todayMs = 0;
  for (const interval of intervals) {
    if (interval.kind === 'work') todayMs += overlapMs(interval.start, interval.end, today, addLocalDays(today, 1));
    for (let index = 0; index < 7; index++) {
      const duration = overlapMs(interval.start, interval.end, days[index]!, days[index + 1]!);
      if (interval.kind === 'break') breakDays[index]! += duration;
      else {
        workDays[index]! += duration;
        const row = byProject.get(interval.projectId!);
        if (row) { row.days[index]! += duration; row.total += duration; }
      }
    }
  }
  return {
    todayMs,
    week: { start: monday, end: days[7]!, days: days.slice(0, 7), rows: rows.filter(row => row.total > 0), workDays, breakDays, workTotal: workDays.reduce((a, b) => a + b, 0), breakTotal: breakDays.reduce((a, b) => a + b, 0) },
  };
}
export function formatDuration(milliseconds: number): string {
  const minutes = Math.floor(milliseconds / 60_000);
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`;
}
