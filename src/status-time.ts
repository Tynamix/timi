import type { Snapshot } from './shared.js';
import { formatDuration } from './core/accounting.js';
import { dailyTargetMs } from './core/work-goals.js';

/** Presentation only: reports and tracking always retain the actual worked milliseconds. */
export function statusTime(state: Pick<Snapshot, 'now' | 'todayMs' | 'settings'>): { text: string; remaining: boolean } {
  const target = dailyTargetMs(state.settings.workGoals, state.now);
  const remaining = state.settings.workGoals.showRemaining === true && target > 0;
  const duration = remaining ? target - state.todayMs : state.todayMs;
  // A positive remainder must not look finished during its last partial minute.
  // Overtime shows completed minutes, like worked time, with a visible minus sign.
  const text = duration < 0 ? `−${formatDuration(-duration)}`
    : formatDuration(remaining ? Math.ceil(duration / 60_000) * 60_000 : duration);
  return { text, remaining };
}
