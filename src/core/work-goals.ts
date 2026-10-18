import type { WorkGoalNotice, WorkGoals } from '../shared.js';
import { accounting } from './accounting.js';
import type { PersistedState, RuntimeState } from './model.js';

export function validWorkGoals(value: unknown): value is WorkGoals {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const goal = value as Record<string, unknown>;
  return Object.keys(goal).every(key => ['dailyHours', 'notifyDaily', 'notifyWeekly'].includes(key))
    && Array.isArray(goal.dailyHours) && goal.dailyHours.length === 7
    && Array.from(goal.dailyHours).every(hours => typeof hours === 'number' && Number.isFinite(hours) && hours >= 0 && hours <= 24)
    && typeof goal.notifyDaily === 'boolean' && typeof goal.notifyWeekly === 'boolean';
}

export const hoursMs = (hours: number): number => Math.round(hours * 3_600_000);
export const weeklyTargetMs = (goals: WorkGoals): number => goals.dailyHours.reduce((sum, hours) => sum + hoursMs(hours), 0);
export const dailyTargetMs = (goals: WorkGoals, at: number): number => hoursMs(goals.dailyHours[(new Date(at).getDay() + 6) % 7]!);
function localDate(at: number): string {
  const date = new Date(at);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/** Only confirmed activity counts: the current idle tail may still need classification. */
export function reachedWorkGoals(state: PersistedState & { runtime: RuntimeState }, now: number): WorkGoalNotice[] {
  const { runtime, settings, records, projects } = state;
  if (runtime.locked || runtime.sleeping || runtime.awaitingReturn || runtime.pending) return [];
  const dayTarget = dailyTargetMs(settings.workGoals, now);
  const weekTarget = weeklyTargetMs(settings.workGoals);
  if ((!settings.workGoals.notifyDaily || dayTarget === 0) && (!settings.workGoals.notifyWeekly || weekTarget === 0)) return [];
  const confirmedEnd = Math.min(now, runtime.lastActivity);
  // Corrections may include future endpoints; they cannot reach a goal before time elapses.
  const elapsedRecords = records.filter(record => record.start < now).map(record => ({ ...record, end: Math.min(record.end, now) }));
  const confirmed = runtime.active?.kind === 'work' && confirmedEnd > runtime.active.start
    ? [...elapsedRecords, { ...runtime.active, id: 'confirmed', end: confirmedEnd, source: 'tracked' as const }] : elapsedRecords;
  const { todayMs, week } = accounting(confirmed, null, projects, now);
  const notices: WorkGoalNotice[] = [];
  if (settings.workGoals.notifyDaily && dayTarget > 0 && todayMs >= dayTarget) notices.push({ kind: 'day', period: localDate(now), targetMs: dayTarget, workedMs: todayMs });
  if (settings.workGoals.notifyWeekly && weekTarget > 0 && week.workTotal >= weekTarget) notices.push({ kind: 'week', period: localDate(week.start), targetMs: weekTarget, workedMs: week.workTotal });
  return notices;
}
